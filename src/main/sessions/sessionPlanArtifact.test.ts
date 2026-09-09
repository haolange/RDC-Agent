import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { StorageIo } from './StorageIo';
import { SessionArtifactResolver } from './SessionArtifactResolver';
import { writeSessionPlanArtifact } from './sessionPlanArtifact';

describe('writeSessionPlanArtifact', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('writes a versioned plan file and never pins artifacts/plan.md', async () => {
    const projectsRoot = await mkdtemp(path.join(os.tmpdir(), 'rdx-plan-artifact-'));
    roots.push(projectsRoot);
    const sessionPath = path.join(projectsRoot, 'sess');
    await mkdir(sessionPath, { recursive: true });
    await writeFile(path.join(sessionPath, 'session.json'), JSON.stringify({
      sessionId: 'sess',
      projectId: 'p',
      title: 't',
      goal: '',
      sessionPath,
      createdAt: 1,
      updatedAt: 1,
    }), 'utf8');

    const resolver = new SessionArtifactResolver({ resolveSessionPath: () => sessionPath, io: new StorageIo() });

    const first = writeSessionPlanArtifact('sess', '# first', resolver).uri;
    const second = writeSessionPlanArtifact('sess', '# second', resolver).uri;
    expect(path.basename(first)).toMatch(/^plan-\d{4}-\d{2}-\d{2}T\d+Z-[a-z0-9]+\.md$/);
    expect(path.basename(second)).toMatch(/^plan-\d{4}-\d{2}-\d{2}T\d+Z-[a-z0-9]+\.md$/);
    expect(path.basename(first)).not.toBe('plan.md');
    expect(path.basename(second)).not.toBe('plan.md');
    expect(first).not.toBe(second);
    expect(first).not.toBe(path.join(sessionPath, 'artifacts', 'plan.md'));
  });
});
