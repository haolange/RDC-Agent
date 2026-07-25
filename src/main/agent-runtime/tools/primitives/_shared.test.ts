import { mkdtemp, rm, writeFile, symlink, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertTextReadable,
  safeResolvePath,
  truncateOutput,
} from './_shared';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('truncateOutput', () => {
  it('keeps Buffer.byteLength within maxBytes for multi-byte text', () => {
    const text = '测'.repeat(5000);
    const maxBytes = 200;
    const out = truncateOutput(text, maxBytes);
    expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(maxBytes);
    expect(out).toContain('truncated');
  });
});

describe('assertTextReadable', () => {
  it('rejects .rdc captures', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-text-rdc-'));
    roots.push(root);
    const file = path.join(root, 'cap.rdc');
    await writeFile(file, 'RDOC\0binary', 'utf8');
    expect(() => assertTextReadable(file)).toThrow(/RenderDoc|\.rdc|binary/i);
  });

  it('rejects NUL-containing binaries', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-text-bin-'));
    roots.push(root);
    const file = path.join(root, 'blob.bin');
    await writeFile(file, Buffer.from([0x00, 0x01, 0x02, 0x03]));
    expect(() => assertTextReadable(file)).toThrow(/binary|NUL/i);
  });
});

describe('safeResolvePath', () => {
  it('rejects symlink escape outside workspace', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-symlink-ws-'));
    const outside = await mkdtemp(path.join(os.tmpdir(), 'rdx-symlink-out-'));
    roots.push(root, outside);
    const secret = path.join(outside, 'secret.txt');
    await writeFile(secret, 'leak', 'utf8');
    const link = path.join(root, 'escape');
    try {
      await symlink(secret, link);
    } catch {
      // Windows may require elevation for symlinks; skip in that environment.
      return;
    }
    expect(() => safeResolvePath('escape', root)).toThrow(/超出 workspace/);
  });

  it('allows ordinary workspace files', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-safe-'));
    roots.push(root);
    await mkdir(path.join(root, 'src'), { recursive: true });
    const file = path.join(root, 'src', 'a.ts');
    await writeFile(file, 'export {}\n', 'utf8');
    expect(safeResolvePath('src/a.ts', root)).toBe(path.resolve(file));
  });

  it('allows temporary roots only from the current ToolExecutionContext', async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'rdx-ws-'));
    const external = await mkdtemp(path.join(os.tmpdir(), 'rdx-ext-'));
    roots.push(workspace, external);
    const externalFile = path.join(external, 'notes.txt');
    await writeFile(externalFile, 'ok', 'utf8');

    expect(() => safeResolvePath(externalFile, workspace)).toThrow(/超出 workspace/);

    const allowed = safeResolvePath(externalFile, workspace, {
      workspaceRoot: workspace,
      projectRootPath: workspace,
      projectId: null,
      sessionId: null,
      temporaryAllowedPathRoots: [external],
    });
    expect(allowed).toBe(path.resolve(externalFile));

    // Concurrent call without the temporary root must still fail (no global leak).
    expect(() => safeResolvePath(externalFile, workspace, {
      workspaceRoot: workspace,
      projectRootPath: workspace,
      projectId: null,
      sessionId: null,
      temporaryAllowedPathRoots: [],
    })).toThrow(/超出 workspace/);
  });
});
