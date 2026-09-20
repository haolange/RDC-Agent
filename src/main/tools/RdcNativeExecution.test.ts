import { isolatedRdcTools } from '../testing/isolatedRdcTools';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, cpSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { InvestigationContentRef, ExperimentRecord } from '@shared/types/renderdocInvestigation';
import { DEFAULT_RDC_CLI_INVOKER } from '../settings/settingsDefaults';
import { SessionArtifactResolver } from '../sessions/SessionArtifactResolver';
import { setRdcRuntimeContextForSession, getRdcContextLease } from '../sessions/RdcRuntimeContextRegistry';
import { RdcExecutionReceipts } from './RdcExecutionReceipts';
import { rdcCliInvokerService } from './RdcCliInvokerService';
import { parseRdcNativeResult } from './RdcNativeProtocol';
import { executeRdcShell } from './executeRdcShell';
import { freezeRdcTurnBinding } from './RdcTurnBindings';
import { assertExecutionEvidence } from '../investigation/investigationExecutionEvidence';
import { recordedExperiment } from '../investigation/investigationTestFixtures';

const state = vi.hoisted(() => ({ receipts: null as RdcExecutionReceipts | null }));
vi.mock('./RdcExecutionReceipts', async (original) => ({
  ...await original<typeof import('./RdcExecutionReceipts')>(),
  rdcExecutionReceipts: {
    prepare: () => state.receipts!.prepare(),
    write: (...args: Parameters<RdcExecutionReceipts['write']>) => state.receipts!.write(...args),
  },
}));
const python = process.env.RDC_NATIVE_PYTHON;
const fixture = process.env.RDC_NATIVE_CAPTURE;
const enabled = Boolean(python && fixture && process.env.RDC_NATIVE_ALLOW_MUTATION === '1');
const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

function cleanupNativeTestDirectory(directory: string, testRoot: string): void {
if (path.dirname(path.resolve(directory)) !== testRoot) throw new Error('Refusing cleanup outside the owned test root');
rmSync(directory, { recursive: true, force: true });
}

describe.skipIf(!enabled)('native process execution and signed A-B-A (explicit disposable capture)', () => {
  it('changes actual pixels, rolls back, and verifies main-issued receipts', { timeout: 180_000 }, async () => {
    const testRoot = path.resolve(path.dirname(python!), '../../../../intermediate/tool-convergence-tests/agent');
    mkdirSync(testRoot, { recursive: true });
    const directory = mkdtempSync(path.join(testRoot, 'native-receipts-'));
    const nativeEnv = isolatedRdcTools(directory, python!);
    const capture = path.join(directory, 'fixture-copy.rdc');
    copyFileSync(fixture!, capture);
    const before = hash(fixture!);
    const contextId = 'qa-receipt-' + randomUUID().slice(0, 12);
    const sessionId = 'qa-session-' + randomUUID();
    const settings = { ...DEFAULT_RDC_CLI_INVOKER, enabled: true, command: python!,
      argsPrefix: [path.resolve(path.dirname(python!), '../../../../cli/run_cli.py')], env: nativeEnv, timeoutMs: 60_000 };
    const resolver = new SessionArtifactResolver({ resolveSessionPath: (id) => id === sessionId ? directory : null });
    const receipts = new RdcExecutionReceipts(resolver, () => 'isolated-integration-signing-key');
    state.receipts = receipts;
    const native = async (command: string, args: string[] = []) => parseRdcNativeResult(
      await rdcCliInvokerService.executeCLI(command, [...args, '--daemon-context', contextId], { settings }));
    let replaySessionId = '';
    let evidence: NonNullable<ExperimentRecord['executionEvidence']> | undefined;
    try {
      const opened = await native('capture', ['open', '--file', capture]);
      replaySessionId = String(opened.data.session_id);
      const eventId = Number(opened.data.active_event_id);
      setRdcRuntimeContextForSession(sessionId, {
        contextId, runtimeOwner: 'qa-native', ownerLeaseId: 'qa-native-lease', replaySessionId,
        captureFileId: String(opened.data.capture_file_id), backend: 'local', updatedAt: Date.now(),
      }, { projectId: 'qa-project' });
      const context = { workspaceRoot: directory, projectRootPath: directory, projectId: 'qa-project',
        sessionId, turnId: 'qa-turn', agentId: 'general', rdcBinding: freezeRdcTurnBinding(settings, (await rdcCliInvokerService.loadCatalog(settings, true)).tools, getRdcContextLease(sessionId)) };
      const invoke = async (phase: string, operation: string, args: Record<string, unknown>) => {
        const result = await executeRdcShell({ operation, args, experimentId: 'qa-aba' }, phase, undefined, context);
        expect(result.isError).not.toBe(true);
        return result.details!.receipt as InvestigationContentRef;
      };
      const outputPath = path.join(directory, 'frame.png');
      const action = await native('event', ['show', '--event-id', String(eventId)]);
      const outputs = (action.data.action as { outputs: string[] }).outputs;
      const textureId = outputs.find((id) => id !== 'ResourceId::0');
      expect(textureId).toBeTruthy();
      const measurement = { event_id: eventId, texture_id: textureId, output_path: outputPath, file_format: 'png' };
      const baseline = await invoke('baseline', 'rd.export.texture', measurement);
      const baselineHash = hash(outputPath);
      copyFileSync(outputPath, path.join(directory, 'baseline.png'));
      const intervention = await invoke('intervention', 'rd.shader.edit_and_replace', {
        event_id: eventId, stage: 'PS', source_encoding: 'glsl', entry: 'main', preserve_outputs: false,
        source_text: '#version 450\nlayout(location=0) out vec4 outColor;\nvoid main(){outColor=vec4(1.0,0.0,1.0,1.0);}',
      });
      const replacementId = receipts.read(sessionId, intervention).result.replacement_id;
      const variant = await invoke('variant', 'rd.export.texture', measurement);
      const variantHash = hash(outputPath);
      copyFileSync(outputPath, path.join(directory, 'variant.png'));
      const rollback = await invoke('rollback', 'rd.shader.revert_replacement', { replacement_id: replacementId });
      const restored = await invoke('restored', 'rd.export.texture', measurement);
      const restoredHash = hash(outputPath);
      copyFileSync(outputPath, path.join(directory, 'restored.png'));
      evidence = { baseline, intervention, variant, rollback, restored };
      assertExecutionEvidence(sessionId, { ...recordedExperiment({
        experimentId: 'qa-aba', hypothesisClaimId: 'qa-hypothesis', baselineWorldStateId: 'qa-baseline',
        variantWorldStateId: 'qa-variant', restoredWorldStateId: 'qa-restored', verifyEvidenceIds: ['qa-visual-restored'],
      }), executionEvidence: evidence }, receipts);
      expect(variantHash).not.toBe(baselineHash);
      expect(restoredHash).toBe(baselineHash);
      writeFileSync(path.join(directory, 'validation.json'), JSON.stringify({ contextId, sessionId, evidence,
        baselineHash, variantHash, restoredHash, sourceHash: before }, null, 2));
      if (process.env.RDC_NATIVE_EXECUTION_OUTPUT) {
        const output = path.resolve(process.env.RDC_NATIVE_EXECUTION_OUTPUT);
        mkdirSync(output, { recursive: true });
        for (const name of ['validation.json', 'baseline.png', 'variant.png', 'restored.png']) {
          copyFileSync(path.join(directory, name), path.join(output, name));
        }
        cpSync(path.join(directory, 'session-artifacts', 'tool-outputs'), path.join(output, 'tool-outputs'), { recursive: true });
      }
      console.info('Native signed execution verified:', directory);
    } finally {
      try {
        if (replaySessionId) {
          const list = await native('call', ['rd.shader.list_replacements', '--args-json', JSON.stringify({ session_id: replaySessionId })]);
          for (const replacement of (list.data.replacements ?? []) as Array<{ replacement_id: string }>) {
            await native('call', ['rd.shader.revert_replacement', '--args-json',
              JSON.stringify({ session_id: replaySessionId, replacement_id: replacement.replacement_id })]);
          }
        }
      } finally {
        await native('context', ['clear']);
        await native('daemon', ['stop']);
        setRdcRuntimeContextForSession(sessionId, null);
        state.receipts = null;
        expect(hash(fixture!)).toBe(before);
        expect(hash(capture)).toBe(before);
        cleanupNativeTestDirectory(directory, testRoot);
      }
    }
  });
});
