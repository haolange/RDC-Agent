import { mkdtemp, rm, writeFile, readFile, symlink, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { ToolExecutionContext } from '../../agent/AgentTool';
import { readFileTool } from './ReadFileTool';
import { editFileTool } from './EditFileTool';
import { writeFileTool } from './WriteFileTool';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-read-gate-')); roots.push(root);
  await writeFile(path.join(root, 'file.txt'), 'before');
  const context: ToolExecutionContext = { workspaceRoot: root, projectRootPath: root, projectId: null, sessionId: 'session', successfulFileReads: new Set() };
  return { root, context };
}
it('requires successful reads for editing and overwriting, across turns but not sessions or restart', async () => {
  const { root, context } = await fixture();
  const edit = (ctx = context) => editFileTool.execute('edit', { path: 'file.txt', old_text: 'before', new_text: 'after' }, undefined, undefined, ctx);
  const overwrite = (ctx = context) => writeFileTool.execute('write', { path: 'file.txt', content: 'overwrite' }, undefined, undefined, ctx);
  await expect(edit()).rejects.toThrow('READ_BEFORE_EDIT_REQUIRED');
  await expect(overwrite()).rejects.toThrow('READ_BEFORE_EDIT_REQUIRED');
  await readFileTool.execute('read', { path: './file.txt' }, undefined, undefined, context);
  await expect(edit({ ...context, turnId: 'next' })).resolves.toBeDefined();
  expect(await readFile(path.join(root, 'file.txt'), 'utf8')).toBe('after');
  await expect(overwrite({ ...context, sessionId: 'child', successfulFileReads: new Set() })).rejects.toThrow('READ_BEFORE_EDIT_REQUIRED');
  await expect(overwrite({ ...context, successfulFileReads: new Set() })).rejects.toThrow('READ_BEFORE_EDIT_REQUIRED');
  await expect(overwrite()).resolves.toBeDefined();
});
it('does not count failed/cancelled reads and permits creating a new file only once', async () => {
  const { context } = await fixture();
  await expect(readFileTool.execute('read', { path: 'absent' }, undefined, undefined, context)).rejects.toThrow();
  await expect(readFileTool.execute('read', { path: 'file.txt' }, AbortSignal.abort(), undefined, context)).rejects.toThrow();
  expect(context.successfulFileReads?.size).toBe(0);
  const write = () => writeFileTool.execute('write', { path: 'new.txt', content: 'new' }, undefined, undefined, context);
  await expect(write()).resolves.toBeDefined();
  await expect(write()).rejects.toThrow('READ_BEFORE_EDIT_REQUIRED');
});
it('keeps the existing symlink rejection even when the canonical file has been read', async () => {
  const { root, context } = await fixture();
  const alias = path.join(root, 'alias');
  await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  try {
    await expect(readFileTool.execute('read', { path: 'alias/file.txt' }, undefined, undefined, context)).rejects.toThrow('SYMLINK_PATH_REJECTED');
    expect(context.successfulFileReads?.size).toBe(0);
    await readFileTool.execute('read', { path: path.join(root, '.', 'file.txt') }, undefined, undefined, context);
    await expect(editFileTool.execute('edit', { path: 'alias/file.txt', old_text: 'before', new_text: 'after' }, undefined, undefined, context)).rejects.toThrow('SYMLINK_PATH_REJECTED');
    expect(await readFile(path.join(root, 'file.txt'), 'utf8')).toBe('before');
  } finally { await unlink(alias); }
});
