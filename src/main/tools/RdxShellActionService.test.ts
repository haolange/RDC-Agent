import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RdxActionId, RdxActionSettingsMap, RdxShellActionSettings } from '@shared/types/settings';
import { createDefaultRdxAction, DEFAULT_RDX_ACTIONS, DEFAULT_RDX_CLI_INVOKER } from '../settings/settingsDefaults';

const invoke = vi.fn();
const spawn = vi.fn();
const getAll = vi.fn();

vi.mock('../settings/SettingsService', () => ({
  settingsService: {
    getAll: (...args: unknown[]) => getAll(...args),
  },
}));

vi.mock('./ShellInvocationService', () => ({
  shellInvocationService: {
    invoke: (...args: unknown[]) => invoke(...args),
  },
}));

vi.mock('../runtime/ProcessSupervisor', () => ({
  processSupervisor: {
    spawn: (...args: unknown[]) => spawn(...args),
  },
}));

vi.mock('../runtime/RuntimeLogService', () => ({
  runtimeLogService: { log: vi.fn() },
}));

vi.mock('../runtime/AppPathService', () => ({
  appPathService: {
    getRuntimePaths: () => ({
      userRdxRoot: '',
      logsPath: '',
      projectsPath: '',
      knowledgePath: '',
    }),
  },
}));

import { rdxShellActionService } from './RdxShellActionService';

const FAIL_CLOSED_ACTIONS = [
  'openCapture',
  'openRemoteCapture',
  'connectRemote',
  'closeRuntime',
] as const satisfies readonly RdxActionId[];

const emptyAction = (): RdxShellActionSettings => createDefaultRdxAction();

const actionMap = (overrides: Partial<RdxActionSettingsMap> = {}): RdxActionSettingsMap => ({
  openCapture: emptyAction(),
  openRemoteCapture: emptyAction(),
  connectRemote: emptyAction(),
  closeRuntime: emptyAction(),
  ...overrides,
});

const expectUnconfigured = async (actionId: RdxActionId) => {
  const result = await rdxShellActionService.runAction(actionId);
  expect(result).toMatchObject({
    ok: false,
    actionId,
    diagnostic: expect.objectContaining({ classification: 'action_not_configured' }),
  });
  expect(invoke).not.toHaveBeenCalled();
  expect(spawn).not.toHaveBeenCalled();
};

describe('RdxShellActionService unconfigured fail-closed', () => {
  beforeEach(() => {
    invoke.mockReset();
    spawn.mockReset();
    getAll.mockReset();
  });

  it('keeps product defaults disabled with an empty command and no rdx.bat path', () => {
    for (const actionId of FAIL_CLOSED_ACTIONS) {
      expect(DEFAULT_RDX_ACTIONS[actionId]).toMatchObject({ enabled: false, command: '' });
    }
    expect(DEFAULT_RDX_CLI_INVOKER).toMatchObject({ enabled: false, command: '' });
    expect(JSON.stringify({ cli: DEFAULT_RDX_CLI_INVOKER, actions: DEFAULT_RDX_ACTIONS })).not.toMatch(/rdx\.bat/i);
  });

  it.each(FAIL_CLOSED_ACTIONS)(
    '%s with product defaults returns action_not_configured and does not spawn',
    async (actionId) => {
      getAll.mockReturnValue({ tooling: { rdxActions: DEFAULT_RDX_ACTIONS } });
      await expectUnconfigured(actionId);
    },
  );

  it.each(FAIL_CLOSED_ACTIONS)(
    '%s with enabled=false does not spawn even when a command is present',
    async (actionId) => {
      getAll.mockReturnValue({
        tooling: {
          rdxActions: actionMap({
            [actionId]: { ...emptyAction(), enabled: false, command: 'C:/tmp/rdx-unconfigured.exe' },
          }),
        },
      });
      await expectUnconfigured(actionId);
    },
  );

  it.each(FAIL_CLOSED_ACTIONS)(
    '%s with enabled=true and an empty command returns action_not_configured and does not spawn',
    async (actionId) => {
      getAll.mockReturnValue({
        tooling: {
          rdxActions: actionMap({
            [actionId]: { ...emptyAction(), enabled: true, command: '' },
          }),
        },
      });
      await expectUnconfigured(actionId);
    },
  );
  it.each(['', 'plain text', '{}', '{"ok":true,"data":{}}'])('rejects noncanonical successful process stdout %j', async (stdout) => {
    getAll.mockReturnValue({ tooling: { rdxActions: actionMap({ closeRuntime: { ...emptyAction(), enabled: true, command: 'native-rdx' } }) } });
    invoke.mockResolvedValue({ exitCode: 0, stdout, stderr: '', duration_ms: 1 });
    const result = await rdxShellActionService.runAction('closeRuntime');
    expect(result.ok).toBe(false);
  });
  it('requires both canonical ok and process success', async () => {
    getAll.mockReturnValue({ tooling: { rdxActions: actionMap({ closeRuntime: { ...emptyAction(), enabled: true, command: 'native-rdx' } }) } });
    const stdout = JSON.stringify({ ok: true, result_kind: 'rdx.context.clear', data: {} });
    invoke.mockResolvedValue({ exitCode: 1, stdout, stderr: '', duration_ms: 1 });
    expect((await rdxShellActionService.runAction('closeRuntime')).ok).toBe(false);
    invoke.mockResolvedValue({ exitCode: 0, stdout, stderr: '', duration_ms: 1 });
    expect((await rdxShellActionService.runAction('closeRuntime')).ok).toBe(true);
  });

});
