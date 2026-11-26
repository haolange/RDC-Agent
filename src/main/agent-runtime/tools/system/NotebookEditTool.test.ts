import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { notebookEditTool } from './NotebookEditTool';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

it('refuses to edit a notebook whose cells are not nbformat cells and leaves it unchanged', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-notebook-')));
  roots.push(root);
  const notebook = path.join(root, 'analysis.ipynb');
  const original = JSON.stringify({ cells: [{ cell_type: 'code', source: 7 }], nbformat: 4 });
  fs.writeFileSync(notebook, original);
  await expect(
    notebookEditTool.execute(
      'call',
      { notebook_path: 'analysis.ipynb', cell_index: 0, new_source: 'print(1)' },
      undefined,
      undefined,
      {
        projectRootPath: root,
        workspaceRoot: root,
        sessionId: 'session',
        projectId: 'project',
      },
    ),
  ).rejects.toThrow('Invalid notebook');
  expect(fs.readFileSync(notebook, 'utf8')).toBe(original);
});
