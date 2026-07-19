import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ToolExecutionContext } from '../../agent/AgentTool';
import { bashTool } from './BashTool';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('BashTool', () => {
  it('runs a cross-platform echo via node -e', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-bash-tool-'));
    roots.push(root);
    const context: ToolExecutionContext = {
      workspaceRoot: root,
      projectRootPath: root,
      projectId: null,
      sessionId: null,
    };

    // BashTool on Windows wraps with cmd /c; avoid nested quote traps.
    const command = process.platform === 'win32'
      ? 'echo hello-rdx'
      : 'node -e \'process.stdout.write("hello-rdx")\'';

    const result = await bashTool.execute(
      'b1',
      { command, timeout: 15_000 },
      undefined,
      undefined,
      context,
    );

    const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
    expect(text).toContain('hello-rdx');
    expect(result.details).toMatchObject({
      exitCode: 0,
      cwd: expect.any(String),
      truncated: false,
    });
  });

  it('rejects run_in_background until background delivery is wired', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-bash-bg-'));
    roots.push(root);
    const context: ToolExecutionContext = {
      workspaceRoot: root,
      projectRootPath: root,
      projectId: null,
      sessionId: null,
    };

    await expect(
      bashTool.execute('b2', { command: 'echo hi', run_in_background: true }, undefined, undefined, context),
    ).rejects.toThrow(/run_in_background is disabled/i);
  });
});
