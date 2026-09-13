import { isolatedRdxTools } from '../testing/isolatedRdxTools';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_RDX_ACTIONS, DEFAULT_RDX_CLI_INVOKER } from '../settings/settingsDefaults';
import { RdxSessionService } from '../sessions/RdxSessionService';
import { getRdxContextLease } from '../sessions/RdxRuntimeContextRegistry';
import { rdxCliInvokerService } from './RdxCliInvokerService';
import { parseRdxNativeResult } from './RdxNativeProtocol';
import { freezeRdxTurnBinding } from './RdxTurnBindings';
import { rdxShellActionService } from './RdxShellActionService';
import { settingsService } from '../settings/SettingsService';

vi.mock('electron', () => ({
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
  BrowserWindow: class { static getAllWindows() { return []; } },
  app: { getPath: () => process.cwd(), getAppPath: () => process.cwd() },
}));
const python = process.env.RDX_NATIVE_PYTHON;
const fixture = process.env.RDX_NATIVE_CAPTURE;
const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

describe.skipIf(!python || !fixture)('native application capture lifecycle', () => {
  it('opens through configured actions, owns the context, confirms preview off and clears the lease', { timeout: 120_000 }, async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'rdc-native-lifecycle-'));
    const nativeEnv = isolatedRdxTools(directory, python!);
    const capture = path.join(directory, 'capture-copy.rdc');
    copyFileSync(fixture!, capture);
    const before = hash(fixture!);
    let contextId = 'qa-lifecycle-' + randomUUID().slice(0, 12);
    const scope = { projectId: 'qa-project', sessionId: 'qa-session-' + randomUUID() };
    const cli = { ...DEFAULT_RDX_CLI_INVOKER, enabled: true, command: python!,
      argsPrefix: ['-m', 'rdx.cli', '--json'], env: nativeEnv, timeoutMs: 60_000 };
    const actions = structuredClone(DEFAULT_RDX_ACTIONS);
    actions.openCapture = { ...actions.openCapture, enabled: true, command: python!, env: nativeEnv,
      args: ['-m', 'rdx.cli', '--json', '--daemon-context', '{{contextId}}', 'capture', 'open', '--file', '{{filePath}}'] };
    actions.closeRuntime = { ...actions.closeRuntime, enabled: true, command: python!, env: nativeEnv,
      args: ['-m', 'rdx.cli', '--json', '--daemon-context', '{{contextId}}', 'context', 'clear'] };
    const binding = freezeRdxTurnBinding(cli, actions);
    const current = settingsService.getAll();
    const settingsSpy = vi.spyOn(settingsService, 'getAll').mockReturnValue({ ...current, tooling: { ...current.tooling, rdxCli: cli } });
    const actionSpy = vi.spyOn(rdxShellActionService, 'runAction');
    const service = new RdxSessionService();
    const native = async (command: string, args: string[]) => parseRdxNativeResult(
      await rdxCliInvokerService.executeCLI(command, [...args, '--daemon-context', contextId], { settings: cli }), contextId);
    try {
      const opened = await service.openProjectInput({ ...scope, inputId: contextId, filePath: capture,
        replayDevice: { id: 'local', type: 'local', label: 'Local', transport: 'local', status: 'online' } }, { binding });
      contextId = opened.contextId;
      expect(opened.replaySessionId).toBeTruthy();
      expect(getRdxContextLease(scope.sessionId)?.contextId).toBe(contextId);
      const context = await native('context', ['status']);
      expect(context.data.session_id ?? context.data.current_session_id).toBe(opened.replaySessionId);
      expect(service.snapshotReplayForSession(scope).phase).toBe('ready');
      expect(await service.clearOpenedCaptureForSession(scope, { binding })).toBe(true);
      expect(getRdxContextLease(scope.sessionId)).toBeNull();
      expect(service.snapshotContextForSession(scope)).toBeNull();
      console.info('Native application lifecycle verified:', directory);
    } finally {
      for (const result of actionSpy.mock.results) if (result.type === 'return') {
        const action = await result.value;
        if (!action.ok) console.info('Native action failure:', action.actionId, action.exitCode, action.error);
      }
      actionSpy.mockRestore();
      settingsSpy.mockRestore();
      await rdxCliInvokerService.executeCLI('daemon', ['stop', '--daemon-context', contextId], { settings: cli });
      expect(hash(fixture!)).toBe(before);
      expect(hash(capture)).toBe(before);
    }
  });
});
