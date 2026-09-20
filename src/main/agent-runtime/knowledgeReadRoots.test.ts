import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  isKnowledgeReadFileTool,
  pathIdentityKey,
  resolveKnowledgeReadRoots,
} from './knowledgeReadRoots';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function makeDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

describe('isKnowledgeReadFileTool', () => {
  it('accepts only the four read-only file tools', () => {
    expect(['read_file', 'read_image', 'glob', 'grep'].every(isKnowledgeReadFileTool)).toBe(true);
    expect([
      'write_file',
      'edit_file',
      'delete_file',
      'shell',
      'code_interpreter',
      'knowledge_search',
    ].some(isKnowledgeReadFileTool)).toBe(false);
  });
});

describe('resolveKnowledgeReadRoots', () => {
  it('freezes existing user and project knowledge directories in canonical order', async () => {
    const user = await makeDir('rdc-kn-user-');
    const project = await makeDir('rdc-kn-proj-');
    const userKnowledge = path.join(user, 'knowledge');
    const projectKnowledge = path.join(project, '.rdc-agent', 'knowledge');
    await mkdir(userKnowledge, { recursive: true });
    await mkdir(projectKnowledge, { recursive: true });

    const resolved = resolveKnowledgeReadRoots({
      userKnowledgePath: userKnowledge,
      projectKnowledgePath: projectKnowledge,
    });
    expect(resolved.roots).toHaveLength(2);
    expect(pathIdentityKey(resolved.roots[0])).toBe(pathIdentityKey(userKnowledge));
    expect(pathIdentityKey(resolved.roots[1])).toBe(pathIdentityKey(projectKnowledge));
    expect(resolved.diagnostics).toEqual([]);
  });

  it('omits missing and non-directory candidates without a symlink diagnostic', async () => {
    const tmp = await makeDir('rdc-kn-miss-');
    const missing = path.join(tmp, 'knowledge');
    const file = path.join(tmp, 'not-a-dir');
    await writeFile(file, 'x', 'utf8');

    const resolved = resolveKnowledgeReadRoots({
      userKnowledgePath: missing,
      projectKnowledgePath: file,
    });
    expect(resolved.roots).toEqual([]);
    expect(resolved.diagnostics.filter((item) => item.reason === 'symlink-or-junction')).toEqual([]);
  });

  it('excludes a knowledge root that is itself a symlink/junction and records a diagnostic', async () => {
    const tmp = await makeDir('rdc-kn-link-');
    const real = path.join(tmp, 'real-knowledge');
    const link = path.join(tmp, 'knowledge');
    await mkdir(real, { recursive: true });
    try {
      await symlink(real, link, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      return;
    }

    const resolved = resolveKnowledgeReadRoots({
      userKnowledgePath: link,
      projectKnowledgePath: null,
    });
    expect(resolved.roots).toEqual([]);
    expect(resolved.diagnostics).toEqual([
      expect.objectContaining({
        candidate: path.resolve(link),
        reason: 'symlink-or-junction',
      }),
    ]);
    expect(resolved.diagnostics[0]?.message).toMatch(/KNOWLEDGE_READ_ROOT_SKIPPED|symlink|junction/i);
  });

  it('treats project-root case aliases as the same knowledge root', async () => {
    const project = await makeDir('rdc-kn-alias-');
    const knowledge = path.join(project, '.rdc-agent', 'knowledge');
    await mkdir(knowledge, { recursive: true });
    const mixedCase = path.join(
      project.replace(/[a-z]/g, (ch) => ch.toUpperCase()),
      '.rdc-agent',
      'knowledge',
    );

    const resolved = resolveKnowledgeReadRoots({
      userKnowledgePath: knowledge,
      projectKnowledgePath: mixedCase,
    });
    expect(resolved.roots).toHaveLength(1);
    expect(pathIdentityKey(resolved.roots[0])).toBe(pathIdentityKey(knowledge));
  });
});
