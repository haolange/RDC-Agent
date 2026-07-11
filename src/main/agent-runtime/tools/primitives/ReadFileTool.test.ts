import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ToolExecutionContext } from '../../agent/AgentTool';
import { readFileTool } from './ReadFileTool';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('ReadFileTool', () => {
  it('reads a workspace file with numbered lines', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-read-file-'));
    roots.push(root);
    await writeFile(path.join(root, 'sample.txt'), 'alpha\nbeta\ngamma\n', 'utf8');
    const context: ToolExecutionContext = {
      workspaceRoot: root,
      projectRootPath: root,
      projectId: null,
      sessionId: null,
    };

    const result = await readFileTool.execute('r1', { path: 'sample.txt' }, undefined, undefined, context);
    const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
    expect(text).toContain('alpha');
    expect(text).toContain('beta');
    expect(result.details).toMatchObject({
      totalLines: 4,
      offset: 1,
      truncated: false,
    });
  });

  it('rejects paths outside the workspace', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-read-escape-'));
    roots.push(root);
    const context: ToolExecutionContext = {
      workspaceRoot: root,
      projectRootPath: root,
      projectId: null,
      sessionId: null,
    };

    await expect(readFileTool.execute('r2', { path: '../outside.txt' }, undefined, undefined, context))
      .rejects.toThrow(/超出 workspace/);
  });
});
