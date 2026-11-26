import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { lockedName } = vi.hoisted(() => ({ lockedName: 'locked.txt' }));
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    access: async (target: string) => {
      if (path.basename(target) === lockedName) throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      return actual.access(target);
    },
  };
});

import { deleteFileTool } from './DeleteFileTool';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function workspace(): {
  root: string;
  context: { workspaceRoot: string; projectRootPath: string; projectId: null; sessionId: null };
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-delete-'));
  roots.push(root);
  return { root, context: { workspaceRoot: root, projectRootPath: root, projectId: null, sessionId: null } };
}

describe('deleteFileTool', () => {
  it('reports a missing file as not existing, and an unreadable one as a failure rather than missing', async () => {
    const { root, context } = workspace();
    fs.writeFileSync(path.join(root, 'present.txt'), 'x');
    const deleted = await deleteFileTool.execute('tc-1', { path: 'present.txt' }, undefined, undefined, context);
    expect(deleted.details).toMatchObject({ existed: true });
    expect(fs.existsSync(path.join(root, 'present.txt'))).toBe(false);

    const missing = await deleteFileTool.execute('tc-2', { path: 'absent.txt' }, undefined, undefined, context);
    expect(missing.details).toMatchObject({ existed: false });

    fs.writeFileSync(path.join(root, lockedName), 'x');
    await expect(deleteFileTool.execute('tc-3', { path: lockedName }, undefined, undefined, context)).rejects.toThrow(
      'permission denied',
    );
    expect(fs.existsSync(path.join(root, lockedName))).toBe(true);
  });
});
