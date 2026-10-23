import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const artifactDirs: string[] = [];
afterEach(async () => {
  const tempRoot = await fs.realpath(os.tmpdir());
  for (const dir of artifactDirs.splice(0)) {
    const target = await fs.realpath(dir);
    expect(path.dirname(target)).toBe(tempRoot);
    expect(path.basename(target)).toMatch(/^rdc-interp-/);
    await fs.rm(target, { recursive: true, force: true });
  }
});

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
    artifactDirs.push(result.details!.artifactsDir);

    expect(spawn).toHaveBeenCalledWith(
      'shell',
      'python',
      expect.arrayContaining(['-c', 'print(42)']),
      expect.objectContaining({ cwd: process.cwd() }),
    );
    expect(result.isError).toBeFalsy();
    expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('42') });
    expect(result.details).toMatchObject({ command: 'python', language: 'python', exitCode: 0 });
    expect(result.details).toMatchObject({
      exitReason: 'exit',
      invocation: {
        kind: 'configured-local-interpreter-execution',
        language: 'python',
        code: 'print(42)',
        codeSha256: createHash('sha256').update('print(42)', 'utf8').digest('hex'),
        argsPrefix: [],
      },
    });
  });

  it.each([
    { reason: 'exit', code: 7 },
    { reason: 'timeout', code: null },
  ])('retains exact executed source and observed $reason failure', async ({ reason, code }) => {
    getAll.mockReturnValue(enabledSettings({ argsPrefix: ['-B'], env: { PRIVATE_TOKEN: 'never-record-env' } }));
    spawn.mockReturnValue({
      child: { stdout: new EventEmitter(), stderr: new EventEmitter() },
      stdout: { toString: () => '' }, stderr: { toString: () => 'actual failure' },
      join: vi.fn(async () => ({ reason, code })),
    });
    const source = 'print("引号 \\" and newline")\nraise SystemExit(7)\n';
    const result = await codeInterpreterTool.execute('failed', { code: source, language: 'py' }, undefined, undefined,
      { workspaceRoot: process.cwd(), projectRootPath: process.cwd(), projectId: 'p1', sessionId: 's1' });
    artifactDirs.push(result.details!.artifactsDir);
    expect(result.isError).toBe(true);
    expect(result.content[0]).toEqual({ type: 'text', text: 'actual failure' });
    expect(result.details).toMatchObject({ exitCode: code, exitReason: reason,
      invocation: { kind: 'configured-local-interpreter-execution', language: 'python', code: source,
        codeSha256: createHash('sha256').update(source, 'utf8').digest('hex'), argsPrefix: ['-B'] } });
    expect(spawn.mock.calls[0]![2]).toEqual(['-B', '-c', source]);
    expect(JSON.stringify(result)).not.toContain('never-record-env');
  });
});
