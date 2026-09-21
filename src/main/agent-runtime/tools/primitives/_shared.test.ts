import { mkdtemp, rm, writeFile, symlink, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertTextReadable,
  safeResolvePath,
  requireMutationWorkspaceRoot,
  sliceUtf8Bytes,
  truncateOutput,
  abortPromise,
  writeTextFileNoFollow,
  withTemporaryPathAccess,
  isWithinRootAllowingAliases,
} from './_shared';
import { readFileTool } from './ReadFileTool';
import { writeFileTool } from './WriteFileTool';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('sliceUtf8Bytes', () => {
  it('truncates on codepoint boundaries in O(N) buffer path', () => {
    const text = '测'.repeat(100);
    const out = sliceUtf8Bytes(text, 10);
    expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(10);
    expect(out.length).toBeGreaterThan(0);
  });
});

describe('abortPromise', () => {
  it('exposes dispose to remove the abort listener', () => {
    const controller = new AbortController();
    const handle = abortPromise(controller.signal);
    handle.dispose();
    controller.abort();
    // Promise must not reject after dispose (listener removed).
    return Promise.race([
      handle.promise.then(
        () => { throw new Error('should not resolve'); },
        () => { throw new Error('should not reject after dispose'); },
      ),
      new Promise<void>((resolve) => setTimeout(resolve, 20)),
    ]);
  });
});

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
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdc-text-rdc-'));
    roots.push(root);
    const file = path.join(root, 'cap.rdc');
    await writeFile(file, 'RDOC\0binary', 'utf8');
    expect(() => assertTextReadable(file)).toThrow(/RenderDoc|\.rdc|binary/i);
  });

  it('rejects NUL-containing binaries', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdc-text-bin-'));
    roots.push(root);
    const file = path.join(root, 'blob.bin');
    await writeFile(file, Buffer.from([0x00, 0x01, 0x02, 0x03]));
    expect(() => assertTextReadable(file)).toThrow(/binary|NUL/i);
  });
});

describe('mutation workspace ownership', () => {
  it('rejects implicit process cwd writes when no project is selected', () => {
    expect(() => requireMutationWorkspaceRoot(undefined)).toThrow(/MUTATION_REQUIRES_PROJECT/);
    expect(() => requireMutationWorkspaceRoot({
      workspaceRoot: process.cwd(),
      projectRootPath: null,
      projectId: null,
      sessionId: null,
    })).toThrow(/MUTATION_REQUIRES_PROJECT/);
  });
});

describe('safeResolvePath', () => {
  it('rejects symlink escape outside workspace', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdc-symlink-ws-'));
    const outside = await mkdtemp(path.join(os.tmpdir(), 'rdc-symlink-out-'));
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
    expect(() => safeResolvePath('escape', root)).toThrow(/workspace|SYMLINK_PATH_REJECTED/);
  });

  it('allows ordinary workspace files', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdc-safe-'));
    roots.push(root);
    await mkdir(path.join(root, 'src'), { recursive: true });
    const file = path.join(root, 'src', 'a.ts');
    await writeFile(file, 'export {}\n', 'utf8');
    expect(safeResolvePath('src/a.ts', root)).toBe(path.resolve(file));
  });

  it('allows temporary roots only from the current ToolExecutionContext', async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'rdc-ws-'));
    const external = await mkdtemp(path.join(os.tmpdir(), 'rdc-ext-'));
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

  it('rejects sibling ~/.rdc-agent/memory and ~/.rdc-agent/agents even when knowledge is a temporary root', async () => {
    const userRdc = await mkdtemp(path.join(os.tmpdir(), 'rdc-kn-sib-'));
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'rdc-kn-ws-'));
    roots.push(userRdc, workspace);
    const knowledge = path.join(userRdc, 'knowledge');
    const memory = path.join(userRdc, 'memory');
    const agents = path.join(userRdc, 'agents');
    await mkdir(knowledge, { recursive: true });
    await mkdir(memory, { recursive: true });
    await mkdir(agents, { recursive: true });
    const memoryFile = path.join(memory, 'note.md');
    const agentFile = path.join(agents, 'ask.md');
    await writeFile(memoryFile, 'secret', 'utf8');
    await writeFile(agentFile, 'secret', 'utf8');
    const context = {
      workspaceRoot: workspace,
      projectRootPath: workspace,
      projectId: null,
      sessionId: null,
      temporaryAllowedPathRoots: [knowledge],
    };
    expect(() => safeResolvePath(memoryFile, workspace, context)).toThrow(/超出 workspace|SYMLINK/);
    expect(() => safeResolvePath(agentFile, workspace, context)).toThrow(/超出 workspace|SYMLINK/);
  });

  it('rejects a junction/symlink planted under a knowledge root that points at a sibling', async () => {
    const userRdc = await mkdtemp(path.join(os.tmpdir(), 'rdc-kn-junc-'));
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'rdc-kn-jws-'));
    roots.push(userRdc, workspace);
    const knowledge = path.join(userRdc, 'knowledge');
    const memory = path.join(userRdc, 'memory');
    await mkdir(knowledge, { recursive: true });
    await mkdir(memory, { recursive: true });
    const secret = path.join(memory, 'secret.md');
    await writeFile(secret, 'leak', 'utf8');
    const planted = path.join(knowledge, 'escape');
    try {
      await symlink(memory, planted, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      return;
    }
    const escaped = path.join(planted, 'secret.md');
    expect(isWithinRootAllowingAliases(escaped, knowledge)).toBe(false);
    expect(() => safeResolvePath(escaped, workspace, {
      workspaceRoot: workspace,
      projectRootPath: workspace,
      projectId: null,
      sessionId: null,
      temporaryAllowedPathRoots: [knowledge],
    })).toThrow(/SYMLINK_PATH_REJECTED/);
  });

  it('read_file rejects a knowledge-root junction that escapes to a sibling', async () => {
    const userRdc = await mkdtemp(path.join(os.tmpdir(), 'rdc-kn-read-junc-'));
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'rdc-kn-read-ws-'));
    roots.push(userRdc, workspace);
    const knowledge = path.join(userRdc, 'knowledge');
    const memory = path.join(userRdc, 'memory');
    await mkdir(knowledge, { recursive: true });
    await mkdir(memory, { recursive: true });
    await writeFile(path.join(memory, 'secret.md'), 'leak', 'utf8');
    const planted = path.join(knowledge, 'escape');
    try {
      await symlink(memory, planted, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      return;
    }
    await expect(readFileTool.execute('r-kn-junc', { path: path.join(planted, 'secret.md') }, undefined, undefined, {
      workspaceRoot: workspace,
      projectRootPath: workspace,
      projectId: null,
      sessionId: null,
      temporaryAllowedPathRoots: [knowledge],
    })).rejects.toThrow(/SYMLINK_PATH_REJECTED/);
  });

  it('write_file rejects a path inside a knowledge root at the execution layer', async () => {
    const userRdc = await mkdtemp(path.join(os.tmpdir(), 'rdc-kn-write-'));
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'rdc-kn-write-ws-'));
    roots.push(userRdc, workspace);
    const knowledge = path.join(userRdc, 'knowledge');
    await mkdir(knowledge, { recursive: true });
    const card = path.join(knowledge, 'card.md');
    await writeFile(card, 'keep', 'utf8');
    await expect(writeFileTool.execute('w-kn', { path: card, content: 'overwrite' }, undefined, undefined, {
      workspaceRoot: workspace,
      projectRootPath: workspace,
      projectId: 'proj',
      sessionId: null,
    })).rejects.toThrow(/超出 workspace/);
  });

  it('resolves a missing target through the existing ancestor and refuses to escape the root', async () => {
    const userRdc = await mkdtemp(path.join(os.tmpdir(), 'rdc-kn-miss-'));
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'rdc-kn-mws-'));
    roots.push(userRdc, workspace);
    const knowledge = path.join(userRdc, 'knowledge');
    await mkdir(knowledge, { recursive: true });
    const context = {
      workspaceRoot: workspace,
      projectRootPath: workspace,
      projectId: null,
      sessionId: null,
      temporaryAllowedPathRoots: [knowledge],
    };
    const missing = path.join(knowledge, 'ghost', 'card.md');
    expect(safeResolvePath(missing, workspace, context)).toBe(path.resolve(missing));
    expect(() => safeResolvePath(path.join(knowledge, '..', 'memory', 'x.md'), workspace, context))
      .toThrow(/超出 workspace|SYMLINK/);
  });

  it('recognizes project-root case aliases as the same knowledge root', async () => {
    const project = await mkdtemp(path.join(os.tmpdir(), 'rdc-kn-case-'));
    roots.push(project);
    const knowledge = path.join(project, '.rdc-agent', 'knowledge');
    await mkdir(knowledge, { recursive: true });
    const file = path.join(knowledge, 'card.md');
    await writeFile(file, 'ok', 'utf8');
    const aliasRoot = knowledge.replace(/[a-z]/g, (ch) => ch.toUpperCase());
    try {
      const { realpathSync } = await import('node:fs');
      if (realpathSync.native(aliasRoot) !== realpathSync.native(knowledge)) return;
    } catch {
      // Case-sensitive filesystems do not provide a case alias to validate.
      return;
    }
    expect(isWithinRootAllowingAliases(file, aliasRoot)).toBe(true);
    expect(safeResolvePath(file, project, {
      workspaceRoot: project,
      projectRootPath: project,
      projectId: null,
      sessionId: null,
      temporaryAllowedPathRoots: [aliasRoot],
    })).toBe(path.resolve(file));
  });

  it('recognizes a Windows 8.3 project alias as the same knowledge root when available', async () => {
    if (process.platform !== 'win32') return;
    const { realpathSync } = await import('node:fs');
    const project = await mkdtemp(path.join(os.tmpdir(), 'rdc-e3ident-'));
    roots.push(project);
    const knowledge = path.join(project, '.rdc-agent', 'knowledge');
    await mkdir(knowledge, { recursive: true });
    const file = path.join(knowledge, 'card.md');
    await writeFile(file, 'ok', 'utf8');
    let shortProject = '';
    try {
      const { execFileSync } = await import('node:child_process');
      const escaped = project.replace(/'/g, "''");
      shortProject = execFileSync(
        'powershell.exe',
        ['-NoProfile', '-Command', `(New-Object -ComObject Scripting.FileSystemObject).GetFolder('${escaped}').ShortPath`],
        { encoding: 'utf8' },
      ).trim().replace(/^["']|["']$/g, '');
    } catch {
      return;
    }
    if (!shortProject) return;
    const shortKnowledge = path.join(shortProject, '.rdc-agent', 'knowledge');
    let realShort = '';
    let realLong = '';
    try {
      realShort = realpathSync.native(shortKnowledge);
      realLong = realpathSync.native(knowledge);
    } catch {
      return;
    }
    if (realShort.toLowerCase() !== realLong.toLowerCase()) return;
    expect(isWithinRootAllowingAliases(file, shortKnowledge)).toBe(true);
    expect(safeResolvePath(path.join(shortKnowledge, 'card.md'), project, {
      workspaceRoot: project,
      projectRootPath: project,
      projectId: null,
      sessionId: null,
      temporaryAllowedPathRoots: [knowledge],
    })).toBe(path.resolve(file));
  });

  it('withTemporaryPathAccess treats missing roots as empty and scopes only the callback', async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'rdc-ws-'));
    roots.push(workspace);
    const context = {
      workspaceRoot: workspace,
      projectRootPath: workspace,
      projectId: null,
      sessionId: null,
    };
    const seen: Array<readonly string[] | undefined> = [];
    await withTemporaryPathAccess(context, undefined, async (scoped) => {
      seen.push(scoped?.temporaryAllowedPathRoots);
    });
    expect(seen[0]).toEqual([]);
  });
});

describe('writeTextFileNoFollow', () => {
  it('writes via sibling temp then atomic rename', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdc-write-atomic-'));
    roots.push(root);
    const target = path.join(root, 'note.txt');
    await writeTextFileNoFollow(target, 'hello-atomic');
    const { readFile } = await import('node:fs/promises');
    expect(await readFile(target, 'utf8')).toBe('hello-atomic');
    await writeTextFileNoFollow(target, 'replaced');
    expect(await readFile(target, 'utf8')).toBe('replaced');
  });
});
