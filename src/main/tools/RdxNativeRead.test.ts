import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_RDX_CLI_INVOKER } from '../settings/settingsDefaults';
import { processSupervisor } from '../runtime/ProcessSupervisor';
import { getRdxContextLease, setRdxRuntimeContextForSession } from '../sessions/RdxRuntimeContextRegistry';
import { rdxCliInvokerService } from './RdxCliInvokerService';
import { parseRdxNativeResult } from './RdxNativeProtocol';
import { freezeRdxTurnBinding } from './RdxTurnBindings';
import { executeRdxShell } from './executeRdxShell';

const root = process.env.RDX_NATIVE_TOOLS_ROOT;
const capture = process.env.RDX_NATIVE_CAPTURE;
describe.skipIf(!root || !capture)('explicit native read-only host acceptance', () => {
  it('runs two structured operations through the same frozen installation, with no discovery process', { timeout: 60000 }, async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'rdx-host-read-'));
    const contextId = 'host-read-' + randomUUID();
    const sessionId = 'host-session-' + randomUUID();
    const settings = { ...DEFAULT_RDX_CLI_INVOKER, enabled: true,
      command: path.join(root!, 'binaries/windows/x64/python/python.exe'),
      argsPrefix: [path.join(root!, 'cli/run_cli.py')], env: { RDX_INTERMEDIATE_ROOT: directory } };
    const processes: Array<Record<string, unknown>> = [];
    const spawn = processSupervisor.spawn.bind(processSupervisor);
    const spy = vi.spyOn(processSupervisor, 'spawn').mockImplementation((owner, command, args, options) => {
      const child = spawn(owner, command, args, options);
      processes.push({ pid: child.pid, parentPid: process.pid, command, args, shell: options?.shell });
      return child;
    });
    const native = async (command: string, args: string[]) => parseRdxNativeResult(await rdxCliInvokerService.executeCLI(command,
      [...args, '--daemon-context', contextId], { settings, contextId }));
    try {
      const catalog = await rdxCliInvokerService.loadCatalog(settings, true);
      const opened = await native('capture', ['open', '--file', capture!]);
      setRdxRuntimeContextForSession(sessionId, { contextId, runtimeOwner: 'qa-native-read', ownerLeaseId: 'qa-owned',
        replaySessionId: String(opened.data.session_id), captureFileId: String(opened.data.capture_file_id), backend: 'local', updatedAt: Date.now() }, { projectId: 'qa-project' });
      const context = { agentId: 'general', sessionId, projectId: 'qa-project', turnId: 'read-turn', projectRootPath: directory,
        workspaceRoot: directory, rdxBinding: freezeRdxTurnBinding(settings, catalog.tools, getRdxContextLease(sessionId)) };
      const before = processes.length;
      await executeRdxShell({ discovery: { kind: 'describe', operation: 'rd.resource.list_all' } }, 'discovery', undefined, context);
      expect(processes).toHaveLength(before);
      const results = [];
      for (const kind of ['texture', 'buffer']) {
        const result = await executeRdxShell({ operation: 'rd.resource.list_all', args: { kind } }, kind, undefined, context);
        expect(result.isError).not.toBe(true);
        expect(result.details?.exitCode).toBe(0);
        results.push(result);
      }
      expect(processes).toHaveLength(before + 2);
      for (const process of processes) {
        expect(process.command).toBe(settings.command);
        expect(process.shell).toBe(false);
        expect(process.pid).toBeGreaterThan(0);
        expect((process.args as string[])[0]).toBe(settings.argsPrefix[0]);
      }
      if (process.env.RDX_NATIVE_READ_OUTPUT) {
        mkdirSync(path.dirname(process.env.RDX_NATIVE_READ_OUTPUT), { recursive: true });
        writeFileSync(process.env.RDX_NATIVE_READ_OUTPUT, JSON.stringify({ fingerprint: catalog.fingerprint, processes, results }, null, 2));
      }
    } finally {
      try {
        await native('context', ['clear']);
        const stop = await native('daemon', ['stop']);
        expect(stop.data.stopped).toBe(true);
      } finally {
        spy.mockRestore();
        setRdxRuntimeContextForSession(sessionId, null);
        rmSync(directory, { recursive: true, force: true });
      }
    }
  });
});
