import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_RDC_CLI_INVOKER } from '../settings/settings-core/settingsDefaults';
import { getRdcContextLease, setRdcRuntimeContextForSession } from './RdcRuntimeContextRegistry';
import { rdcCliInvokerService } from './RdcCliInvokerService';
import { parseRdcNativeResult, RdcNativeFailure } from './RdcNativeProtocol';
import { parseRdcProcessIdentity } from './RdcProcessIdentity';
import { freezeRdcTurnBinding } from './RdcTurnBindings';
import { executeRdcShell } from './executeRdcShell';

const root = process.env.RDC_NATIVE_TOOLS_ROOT;
const capture = process.env.RDC_NATIVE_CAPTURE;
const phase = process.env.RDC_NATIVE_REJECTION_PHASE;
const output = process.env.RDC_NATIVE_REJECTION_OUTPUT;

describe.skipIf(!root || !capture || !phase || !output)('native event rejection acceptance', () => {
  it('records rejection, lease, live replay and owned cleanup', { timeout: 180000 }, async () => {
    const parent = path.dirname(output!);
    mkdirSync(parent, { recursive: true });
    const captureHash = () => createHash('sha256').update(readFileSync(capture!)).digest('hex');
    const originalCaptureHash = captureHash();
    const results: unknown[] = [];
    const operations = ['rd.event.set_active', 'rd.pipeline.get_state'] as const;
    const groups = phase === 'before' ? operations.map(operation => [operation]) : [operations];
    for (const group of groups) {
      const directory = mkdtempSync(path.join(parent, 'rejection-owned-'));
      const contextId = 'rejection-' + randomUUID();
      const ownerId = 'rejection-session-' + randomUUID();
      const settings = { ...DEFAULT_RDC_CLI_INVOKER, enabled: true, timeoutMs: 30000, workingDirectory: root!,
        command: path.join(root!, 'binaries/windows/x64/python/python.exe'),
        argsPrefix: [path.join(root!, 'cli/run_cli.py')],
        env: { RDC_TOOL_INTERMEDIATE_ROOT: directory, PYTHONDONTWRITEBYTECODE: '1' } };
      const native = async (command: string, args: string[]) => parseRdcNativeResult(await rdcCliInvokerService.executeCLI(command,
        [...args, '--daemon-context', contextId], { settings, contextId }));
      const originalExecute = rdcCliInvokerService.executeCLI.bind(rdcCliInvokerService);
      const captured: Array<{ operation: string; exitCode: number; stdout: string }> = [];
      const spy = vi.spyOn(rdcCliInvokerService, 'executeCLI').mockImplementation(async (...args) => {
        const result = await originalExecute(...args);
        if (args[0] === 'call' && group.includes(args[1]?.[0] as typeof operations[number])) {
          captured.push({ operation: args[1]![0], exitCode: result.exitCode, stdout: result.stdout });
        }
        return result;
      });
      let identity: ReturnType<typeof parseRdcProcessIdentity> | undefined;
      let cleaned = false;
      try {
        const catalog = await rdcCliInvokerService.loadCatalog(settings, true);
        const guide = JSON.parse(readFileSync(path.join(process.cwd(), 'scripts/fidelity/rdc-tool-guide-catalog.json'), 'utf8')) as {
          fingerprint: string; tool_count: number };
        expect(catalog.fingerprint).toBe(guide.fingerprint);
        expect(catalog.tools).toHaveLength(guide.tool_count);
        const opened = await native('capture', ['open', '--file', capture!]);
        const before = await native('call', ['rd.session.get_context', '--args-json', '{}']);
        const runtime = before.data.runtime as Record<string, unknown>;
        identity = parseRdcProcessIdentity((before.meta as Record<string, unknown>).process_identity);
        const replaySessionId = opened.data.session_id as string;
        const captureFileId = opened.data.capture_file_id as string;
        expect(runtime.session_id).toBe(replaySessionId);
        expect(runtime.capture_file_id).toBe(captureFileId);
        setRdcRuntimeContextForSession(ownerId, { contextId, runtimeOwner: ownerId, ownerLeaseId: contextId,
          replaySessionId, captureFileId, backend: 'local', updatedAt: Date.now() }, { projectId: 'qa-project' });
        const lease = getRdcContextLease(ownerId);
        const context = { agentId: 'general', accessCeiling: 'full' as const, sessionId: ownerId, projectId: 'qa-project',
          turnId: 'rejection-turn', projectRootPath: directory, workspaceRoot: directory,
          rdcBinding: freezeRdcTurnBinding(settings, catalog.tools, lease) };
        const entries = [];
        for (const operation of group) {
          const error = await executeRdcShell({ operation, args: { event_id: 2147483647 } },
            operation, undefined, context).catch((caught: unknown) => caught);
          expect(error).toBeInstanceOf(RdcNativeFailure);
          const failure = error as RdcNativeFailure;
          expect(failure.nativeError.code).toBe('event_not_found');
          const expected = phase === 'before'
            ? { preservationVerified: false, leaseState: 'quarantined' }
            : { preservationVerified: true, leaseState: 'retained' };
          expect((failure.deliveryResult?.details as Record<string, unknown> | undefined)?.mainValidation).toMatchObject(expected);
          expect(Boolean(getRdcContextLease(ownerId)?.quarantineReason)).toBe(phase === 'before');
          entries.push({ operation, delivery: failure.deliveryResult });
        }
        expect(captured).toHaveLength(group.length);
        if (phase !== 'before') {
          const after = await native('call', ['rd.session.get_context', '--args-json', '{}']);
          expect(after.data.runtime).toMatchObject({ session_id: replaySessionId, capture_file_id: captureFileId,
            active_event_id: runtime.active_event_id });
          expect(parseRdcProcessIdentity((after.meta as Record<string, unknown>).process_identity)).toEqual(identity);
          const valid = await executeRdcShell({ operation: 'rd.event.get_action_details',
            args: { event_id: runtime.active_event_id as number } }, 'valid-event', undefined, context);
          expect(valid.isError).not.toBe(true);
          expect(getRdcContextLease(ownerId)).toEqual(lease);
        }
        expect(captureHash()).toBe(originalCaptureHash);
        results.push({ phase, entries, captured, fingerprint: catalog.fingerprint, captureSha256: originalCaptureHash,
          originalEvent: runtime.active_event_id, processIdentity: identity });
      } finally {
        try {
          await native('context', ['clear']);
          const stopped = await native('daemon', ['stop']);
          expect(stopped.data.stopped).toBe(true);
          if (identity) for (const processIdentity of [identity.daemon, identity.worker]) {
            await vi.waitFor(() => {
              let code: string | undefined;
              try { process.kill(processIdentity.pid, 0); } catch (error) { code = (error as NodeJS.ErrnoException).code; }
              expect(code).toBe('ESRCH');
            }, { timeout: 10000, interval: 50 });
          }
          cleaned = true;
        } finally {
          spy.mockRestore();
          setRdcRuntimeContextForSession(ownerId, null);
          if (cleaned) rmSync(directory, { recursive: true, force: true });
        }
      }
    }
    writeFileSync(output!, JSON.stringify({ phase, results }, null, 2));
  });
});
