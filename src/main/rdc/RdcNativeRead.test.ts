import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_RDC_CLI_INVOKER } from '../settings/settings-core/settingsDefaults';
import { processSupervisor } from '../runtime/ProcessSupervisor';
import { getRdcContextLease, setRdcRuntimeContextForSession } from './RdcRuntimeContextRegistry';
import { rdcCliInvokerService } from './RdcCliInvokerService';
import { parseRdcNativeResult, RdcNativeFailure } from './RdcNativeProtocol';
import { parseRdcProcessIdentity } from './RdcProcessIdentity';
import { freezeRdcTurnBinding } from './RdcTurnBindings';
import { executeRdcShell } from './executeRdcShell';

const root = process.env.RDC_NATIVE_TOOLS_ROOT;
const capture = process.env.RDC_NATIVE_CAPTURE;
describe.skipIf(!root || !capture)('explicit native read-only host acceptance', () => {
  it('runs frozen reads and retains the owning replay after an unsupported stage', { timeout: 120000 }, async () => {
    const outputRoot = process.env.RDC_NATIVE_READ_OUTPUT ? path.dirname(process.env.RDC_NATIVE_READ_OUTPUT) : path.join(root!, 'intermediate', 'native-read-acceptance');
    mkdirSync(outputRoot, { recursive: true });
    const directory = mkdtempSync(path.join(outputRoot, 'rdc-host-read-'));
    const contextSnapshots: unknown[] = [];
    const contextId = 'host-read-' + randomUUID();
    const sessionId = 'host-session-' + randomUUID();
    const captureHash = () => createHash('sha256').update(readFileSync(capture!)).digest('hex');
    const inputHash = captureHash();
    const settings = { ...DEFAULT_RDC_CLI_INVOKER, enabled: true, timeoutMs: 30000, workingDirectory: root!,
      command: path.join(root!, 'binaries/windows/x64/python/python.exe'),
      argsPrefix: [path.join(root!, 'cli/run_cli.py')],
      env: { RDC_TOOL_ROOT: root!, RDC_TOOL_INTERMEDIATE_ROOT: directory, PYTHONDONTWRITEBYTECODE: '1' } };
    const processes: Array<Record<string, unknown>> = [];
    const stageResults: Array<{ exitCode: number; envelope: Record<string, unknown> }> = [];
    const receipt: Record<string, unknown> = { toolsRoot: root, capture, inputSha256: inputHash, contextId, sessionId };
    const children: Array<ReturnType<typeof processSupervisor.spawn>> = [];
    const spawn = processSupervisor.spawn.bind(processSupervisor);
    const spy = vi.spyOn(processSupervisor, 'spawn').mockImplementation((owner, command, args, options) => {
      const child = spawn(owner, command, args, options);
      children.push(child);
      processes.push({ pid: child.pid, parentPid: process.pid, command, args, shell: options?.shell });
      return child;
    });
    const execute = rdcCliInvokerService.executeCLI.bind(rdcCliInvokerService);
    const invokeSpy = vi.spyOn(rdcCliInvokerService, 'executeCLI').mockImplementation(async (...args) => {
      const result = await execute(...args);
      if (args[0] === 'call' && args[1]?.[0] === 'rd.pipeline.get_stage_state') {
        stageResults.push({ exitCode: result.exitCode, envelope: JSON.parse(result.stdout) as Record<string, unknown> });
      }
      return result;
    });
    const native = async (command: string, args: string[]) => parseRdcNativeResult(await rdcCliInvokerService.executeCLI(command,
      [...args, '--daemon-context', contextId], { settings, contextId }));
    const snapshot = async () => {
      const result = await native('call', ['rd.session.get_context', '--args-json', '{}']);
      contextSnapshots.push(result);
      const runtime = result.data.runtime as Record<string, unknown>;
      const sessions = result.data.sessions as Array<Record<string, unknown>>;
      const session = sessions.find(item => item.session_id === result.data.current_session_id)!;
      expect(result.data.context_id).toBe(contextId);
      expect(session).toBeDefined();
      const identity = { contextId: result.data.context_id, replaySessionId: runtime.session_id,
        captureFileId: runtime.capture_file_id, eventId: runtime.active_event_id, replacements: session.shader_replacements,
        processIdentity: parseRdcProcessIdentity((result.meta as Record<string, unknown>).process_identity) };
      expect(identity.replaySessionId).toBe(result.data.current_session_id);
      expect(identity.captureFileId).toBe(session.capture_file_id);
      return identity;
    };
    let stopped = false;
    try {
      const catalog = await rdcCliInvokerService.loadCatalog(settings, true);
      const opened = await native('capture', ['open', '--file', capture!]);
      receipt.opened = opened;
      const original = await snapshot();
      receipt.original = original;
      const daemonStatus = await native('daemon', ['status']);
      const daemonState = structuredClone(daemonStatus.data.state as Record<string, unknown>);
      delete daemonState.token;
      receipt.daemonStatus = { ...daemonStatus, data: { ...daemonStatus.data, state: daemonState } };
      const worker = daemonState.worker as Record<string, unknown>;
      // The public daemon projection omits this existing worker-owned diagnostic sidecar.
      const workerStatePath = path.join(directory, 'runtime', 'worker-state', `worker_state_${contextId}.json`);
      const workerState = JSON.parse(readFileSync(workerStatePath, 'utf8')) as Record<string, unknown>;
      receipt.workerDiagnostic = { path: workerStatePath, state: workerState };
      expect(workerState.context_id).toBe(contextId);
      expect(workerState.pid).toBe(original.processIdentity.worker.pid);
      const loaded = workerState.loaded_runtime as Record<string, unknown>;
      expect(worker.pid).toBe(original.processIdentity.worker.pid);
      expect(loaded).toMatchObject({ status: 'observed', configured_paths_match: true });
      for (const [key, relative] of [['native', 'binaries/windows/x64/renderdoc.dll'], ['binding', 'binaries/windows/x64/pymodules/renderdoc.pyd']]) {
        const component = loaded[key] as { path: string; on_disk: { sha256: string } };
        const expectedPath = path.resolve(root!, relative);
        expect(path.resolve(component.path).toLowerCase()).toBe(expectedPath.toLowerCase());
        expect(component.on_disk.sha256).toBe(createHash('sha256').update(readFileSync(expectedPath)).digest('hex'));
      }
      expect(original.replaySessionId).toBe(opened.data.session_id);
      expect(original.captureFileId).toBe(opened.data.capture_file_id);
      expect(original.replacements).toEqual([]);
      expect(typeof original.replaySessionId).toBe('string');
      expect(typeof original.captureFileId).toBe('string');
      setRdcRuntimeContextForSession(sessionId, { contextId, runtimeOwner: sessionId, ownerLeaseId: contextId,
        replaySessionId: original.replaySessionId as string, captureFileId: original.captureFileId as string,
        backend: 'local', updatedAt: Date.now() }, { projectId: 'qa-project' });
      const frozenLease = getRdcContextLease(sessionId);
      const context = { agentId: 'general', accessCeiling: 'full' as const, sessionId, projectId: 'qa-project',
        turnId: 'read-turn', projectRootPath: directory, workspaceRoot: directory,
        rdcBinding: freezeRdcTurnBinding(settings, catalog.tools, frozenLease) };
      const before = processes.length;
      await executeRdcShell({ discovery: { kind: 'describe', operation: 'rd.resource.list_all' } }, 'discovery', undefined, context);
      expect(processes).toHaveLength(before);
      const results = [];
      for (const kind of ['texture', 'buffer']) {
        const result = await executeRdcShell({ operation: 'rd.resource.list_all', args: { kind } }, kind, undefined, context);
        expect(result.isError).not.toBe(true);
        expect(result.details?.exitCode).toBe(0);
        results.push(result);
      }
      expect(processes).toHaveLength(before + 2);
      const beforeRt = processes.length;
      const rejected = await executeRdcShell({ operation: 'rd.pipeline.get_stage_state', args: { stage: 'RT' } },
        'unsupported-stage', undefined, context).catch((error: unknown) => error);
      expect(rejected).toBeInstanceOf(RdcNativeFailure);
      expect((rejected as RdcNativeFailure).deliveryResult).toMatchObject({ isError: true, details: {
        nativeFailure: { code: 'shader_stage_unsupported', category: 'capability',
          proof: { effects_attempted: false, context_preserved: true } },
        mainValidation: { preservationVerified: true, leaseState: 'retained' },
      } });
      expect((rejected as RdcNativeFailure).deliveryResult?.details).not.toHaveProperty('receipt');
      expect(processes).toHaveLength(beforeRt + 1);
      expect(getRdcContextLease(sessionId)).toEqual(frozenLease);
      const afterRt = await snapshot();
      expect(afterRt).toEqual(original);
      const ps = await executeRdcShell({ operation: 'rd.pipeline.get_stage_state', args: { stage: 'PS' } },
        'explicit-valid-stage', undefined, context);
      expect(ps.isError).not.toBe(true);
      expect(ps.details?.exitCode).toBe(0);
      const psText = ps.content.find(item => item.type === 'text');
      expect(psText?.type).toBe('text');
      expect(JSON.parse(psText?.type === 'text' ? psText.text : '')).toMatchObject({ result: { ok: true,
        result_kind: 'rd.pipeline.get_stage_state', data: { stage_state: { stage: 'PS' }, resolved_event_id: original.eventId } } });
      expect(stageResults).toHaveLength(2);
      expect(stageResults[0]).toMatchObject({ exitCode: 1, envelope: { ok: false, error: {
        code: 'shader_stage_unsupported', category: 'capability', details: {
          failure_stage: 'validate_stage', effects_attempted: false, context_preserved: true } } } });
      for (const stage of stageResults) expect(parseRdcProcessIdentity(
        (stage.envelope.meta as Record<string, unknown>).process_identity)).toEqual(original.processIdentity);
      const afterPs = await snapshot();
      expect(afterPs).toEqual(original);
      expect(getRdcContextLease(sessionId)).toEqual(frozenLease);
      expect(captureHash()).toBe(inputHash);
      for (const process of processes) {
        expect(process.command).toBe(settings.command);
        expect(process.shell).toBe(false);
        expect(process.pid).toBeGreaterThan(0);
        expect((process.args as string[])[0]).toBe(settings.argsPrefix[0]);
      }
      Object.assign(receipt, { verified: true, fingerprint: catalog.fingerprint, results, stageResults, afterRt, afterPs,
        rejection: (rejected as RdcNativeFailure).deliveryResult, finalLease: getRdcContextLease(sessionId) });
    } finally {
      try {
        try { receipt.clear = await native('context', ['clear']); }
        finally {
          const stop = await native('daemon', ['stop']);
          receipt.stop = stop;
          expect(stop.data.stopped).toBe(true);
          const original = receipt.original as Awaited<ReturnType<typeof snapshot>> | undefined;
          expect(original).toBeDefined();
          const exitedIdentities = [];
          for (const identity of [original!.processIdentity.daemon, original!.processIdentity.worker]) {
            await vi.waitFor(() => {
              let exitCode: string | undefined;
              try { process.kill(identity.pid, 0); } catch (error) { exitCode = (error as NodeJS.ErrnoException).code; }
              expect(exitCode).toBe('ESRCH');
            }, { timeout: 10000, interval: 50 });
            exitedIdentities.push({ ...identity, observed: 'ESRCH' });
          }
          receipt.exitedIdentities = exitedIdentities;
          const childExits = await Promise.all(children.map(child => child.join(1000)));
          expect(childExits.every(exit => exit.reason !== 'unconfirmed_orphan')).toBe(true);
          receipt.childExits = childExits;
          stopped = true;
        }
      } finally {
        invokeSpy.mockRestore();
        spy.mockRestore();
        setRdcRuntimeContextForSession(sessionId, null);
        if (stopped) rmSync(directory, { recursive: true, force: true });
        Object.assign(receipt, { processes, contextSnapshots, inputSha256After: captureHash(), stateDirectory: directory, cleanup: { daemonWorkerExited: stopped, temporaryDirectoryRemoved: stopped } });
        if (process.env.RDC_NATIVE_READ_OUTPUT) {
          mkdirSync(path.dirname(process.env.RDC_NATIVE_READ_OUTPUT), { recursive: true });
          writeFileSync(process.env.RDC_NATIVE_READ_OUTPUT, JSON.stringify(receipt, (key, value: unknown) => key === 'token' ? undefined : value, 2));
        }
        expect(receipt.inputSha256After).toBe(inputHash);
      }
    }
  });
});
