import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => process.env.TEMP ?? process.cwd(),
    getAppPath: () => process.cwd(),
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    decryptString: () => '',
    encryptString: (value: string) => Buffer.from(value),
  },
}));

import { createRdxProbeTool } from './RdxProbeTool';
import { setRdxRuntimeContextForSession } from '../../sessions/RdxRuntimeContextRegistry';
import { toolValidator } from '../../agent-runtime/core/ToolValidator';

describe('createRdxProbeTool', () => {
  it('fail-closes when Settings rdxCli is not configured', async () => {
    const tool = createRdxProbeTool('session-a', 'project-a', {
      getRdxCliSettings: () => ({
        enabled: false,
        command: '',
        argsPrefix: [],
        workingDirectory: '',
        env: {},
        timeoutMs: 1000,
        catalogPath: '',
        jsonMode: 'auto',
      }),
      executeCli: vi.fn(),
    });
    const result = await tool.execute('tc-1', { action: 'doctor' });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringMatching(/RDX_PROBE_UNCONFIGURED/),
    });
  });

  it('rejects mutate action names on probe', async () => {
    const executeCli = vi.fn();
    const tool = createRdxProbeTool('session-a', 'project-a', {
      getRdxCliSettings: () => ({
        enabled: true,
        command: 'C:/configured/rdx.exe',
        argsPrefix: [],
        workingDirectory: '',
        env: {},
        timeoutMs: 1000,
        catalogPath: '',
        jsonMode: 'auto',
      }),
      executeCli,
    });
    const result = await tool.execute('tc-2', {
      action: 'probe',
      args: { action: 'shader-replace' },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringMatching(/RDX_PROBE_MUTATE_DENIED/),
    });
    expect(executeCli).not.toHaveBeenCalled();
  });

  it('invokes a configured read-only CLI action and never returns raw .rdc bytes', async () => {
    const executeCli = vi.fn(async () => ({
      exitCode: 0,
      stdout: 'RDOC\u0000not-a-capture',
      stderr: '',
      duration_ms: 12,
    }));
    const tool = createRdxProbeTool('session-a', 'project-a', {
      getRdxCliSettings: () => ({
        enabled: true,
        command: 'C:/configured/rdx.exe',
        argsPrefix: [],
        workingDirectory: '',
        env: {},
        timeoutMs: 1000,
        catalogPath: '',
        jsonMode: 'auto',
      }),
      executeCli,
    });
    const result = await tool.execute('tc-3', { action: 'version' });
    expect(result.isError).not.toBe(true);
    expect(executeCli).toHaveBeenCalledWith('version', ['--session-id', 'session-a'], expect.anything());
    const payload = JSON.parse((result.content[0] as { text: string }).text) as { stdout: string; omittedBinary: boolean };
    expect(payload.omittedBinary).toBe(true);
    expect(payload.stdout).not.toContain('RDOC');
  });

  it('opens and closes only the current session lease', async () => {
    const executeCli = vi.fn(async () => ({
      exitCode: 0,
      stdout: '{"ok":true}',
      stderr: '',
      duration_ms: 4,
    }));
    const setLease = vi.fn(setRdxRuntimeContextForSession);
    const tool = createRdxProbeTool('session-a', 'project-a', {
      getRdxCliSettings: () => ({
        enabled: true,
        command: 'C:/configured/rdx.exe',
        argsPrefix: [],
        workingDirectory: '',
        env: {},
        timeoutMs: 1000,
        catalogPath: '',
        jsonMode: 'auto',
      }),
      executeCli,
      setLease,
    });
    const opened = await tool.execute('tc-open', {
      action: 'lease_open',
      capturePath: 'D:/captures/demo.rdc',
      contextId: 'ctx-1',
    });
    expect(opened.isError).not.toBe(true);
    expect(setLease).toHaveBeenCalledWith(
      'session-a',
      expect.objectContaining({ contextId: 'ctx-1' }),
      { projectId: 'project-a' },
    );

    const closed = await tool.execute('tc-close', { action: 'lease_close' });
    expect(closed.isError).not.toBe(true);
    expect(setLease).toHaveBeenCalledWith('session-a', null);
  });

  it('accepts version without args under the closed ToolValidator schema', () => {
    const tool = createRdxProbeTool('session-a', 'project-a');
    expect(() => toolValidator.validate({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }, { action: 'version' })).not.toThrow();
    expect(() => toolValidator.validate({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }, { action: 'probe', args: { action: 'doctor' } })).not.toThrow();
  });
});
