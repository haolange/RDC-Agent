import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getAll, spawn } = vi.hoisted(() => ({
  getAll: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('../../../settings/SettingsService', () => ({
  settingsService: { getAll },
}));

vi.mock('../../../runtime/ProcessSupervisor', () => ({
  processSupervisor: { spawn },
}));

vi.mock('../../../conversation/ToolImagePreviewStore', () => ({
  recordToolImagePreview: vi.fn(),
}));

import { codeInterpreterTool } from './CodeInterpreterTool';

function enabledSettings(overrides: Record<string, unknown> = {}) {
  return {
    tooling: {
      codeInterpreter: {
        enabled: true,
        command: 'python',
        argsPrefix: [],
        timeoutMs: 5000,
        env: {},
        artifactsEnabled: true,
        ...overrides,
      },
    },
  };
}

describe('CodeInterpreterTool', () => {
  beforeEach(() => {
    getAll.mockReset();
    spawn.mockReset();
  });

  it('fails closed when the interpreter is disabled', async () => {
    getAll.mockReturnValue(enabledSettings({ enabled: false }));
    await expect(codeInterpreterTool.execute(
      'py-1',
      { code: 'print(1)' },
      undefined,
      undefined,
      { workspaceRoot: 'D:/proj', projectRootPath: 'D:/proj', projectId: 'p1', sessionId: 's1' },
    )).rejects.toThrow('CODE_INTERPRETER_DISABLED');
  });

  it('rejects unsupported languages', async () => {
    getAll.mockReturnValue(enabledSettings());
    await expect(codeInterpreterTool.execute(
      'py-1',
      { code: 'puts 1', language: 'ruby' },
      undefined,
      undefined,
      { workspaceRoot: 'D:/proj', projectRootPath: 'D:/proj', projectId: 'p1', sessionId: 's1' },
    )).rejects.toThrow('CODE_INTERPRETER_UNSUPPORTED_LANGUAGE');
  });

  it('requires a project root before spawning', async () => {
    getAll.mockReturnValue(enabledSettings());
    await expect(codeInterpreterTool.execute(
      'py-1',
      { code: 'print(1)' },
      undefined,
      undefined,
      { workspaceRoot: '', projectRootPath: null, projectId: null, sessionId: 's1' },
    )).rejects.toThrow('MUTATION_REQUIRES_PROJECT');
  });

  it('runs the configured interpreter and returns stdout', async () => {
    getAll.mockReturnValue(enabledSettings());
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    spawn.mockReturnValue({
      child: { stdout, stderr },
      stdout: { toString: () => '42' },
      stderr: { toString: () => '' },
      join: vi.fn(async () => ({ reason: 'exit', code: 0 })),
    });

    const result = await codeInterpreterTool.execute(
      'py-1',
      { code: 'print(42)' },
      undefined,
      undefined,
      { workspaceRoot: process.cwd(), projectRootPath: process.cwd(), projectId: 'p1', sessionId: 's1' },
    );

    expect(spawn).toHaveBeenCalledWith(
      'shell',
      'python',
      expect.arrayContaining(['-c', 'print(42)']),
      expect.objectContaining({ cwd: process.cwd() }),
    );
    expect(result.isError).toBeFalsy();
    expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('42') });
    expect(result.details).toMatchObject({ command: 'python', language: 'python', exitCode: 0 });
  });
});
