import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ToolExecutionContext } from '../../agent/AgentTool';
import { gitAddTool, gitStatusTool } from './GitTool';

const execFileAsync = promisify(execFile);
const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function contextFor(root: string): ToolExecutionContext {
  return {
    workspaceRoot: root,
    projectRootPath: root,
    projectId: null,
    sessionId: null,
  };
}

describe('GitTool', () => {
  it('rejects absolute and parent-escaping paths before git runs', async () => {
    await expect(gitAddTool.execute('g1', { path: '../escape.txt' }, undefined, undefined, contextFor(process.cwd())))
      .rejects.toThrow(/Invalid git path/);
    await expect(gitAddTool.execute('g2', { path: 'C:\\Windows\\system32' }, undefined, undefined, contextFor(process.cwd())))
      .rejects.toThrow(/Invalid git path/);
  });

  it('runs git_status in a temporary repository', { timeout: 30_000 }, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-git-tool-'));
    roots.push(root);
    await execFileAsync('git', ['init'], { cwd: root, windowsHide: true });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: root, windowsHide: true });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: root, windowsHide: true });
    await writeFile(path.join(root, 'readme.txt'), 'hello\n', 'utf8');

    const result = await gitStatusTool.execute('g3', { short: true }, undefined, undefined, contextFor(root));
    const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
    expect(text).toMatch(/readme\.txt|No commits yet|##/);
    expect(result.details).toMatchObject({ cwd: expect.any(String), args: expect.any(Array) });
  });
});
