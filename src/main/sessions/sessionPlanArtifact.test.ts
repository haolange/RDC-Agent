import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { StorageIo } from './StorageIo';
import { SessionArtifactResolver } from './SessionArtifactResolver';
import {
  LIVE_PLAN_URI,
  PlanArtifactWriter,
  composePlanMarkdown,
  sectionsFromMarkdown,
} from './sessionPlanArtifact';

describe('PlanArtifactWriter', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('overwrites session://plans/plan.md and freezes an approved copy', async () => {
    const projectsRoot = await mkdtemp(path.join(os.tmpdir(), 'rdc-plan-artifact-'));
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
    const writer = new PlanArtifactWriter(resolver);
    const first = writer.writeLivePlan('sess', '# first\n\n## Goal\none\n');
    const second = writer.writeLivePlan('sess', '# second\n\n## Goal\ntwo\n');
    expect(first.uri).toBe(LIVE_PLAN_URI);
    expect(second.uri).toBe(LIVE_PLAN_URI);
    expect(first.hash).not.toBe(second.hash);
    const frozen = writer.freezeApprovedPlan('sess', second.hash);
    expect(frozen.uri).toMatch(/^session:\/\/plans\/plan-\d{4}-\d{2}-\d{2}T\d+Z-[a-f0-9]{8}\.md$/);
    expect(frozen.hash).toBe(second.hash);
    const live = writer.readMarkdown('sess', LIVE_PLAN_URI, second.hash);
    expect(live.markdown).toContain('## Goal\ntwo');
  });
});

describe('plan markdown helpers', () => {
  it('composes title, summary and content then splits ## sections', () => {
    const markdown = composePlanMarkdown({
      title: 'Frame drop',
      summary: ['Check GPU', 'Compare EID'],
      content: '## Goal\nFind the drop.\n## Inputs\nCapture A.',
    });
    expect(markdown).toContain('# Frame drop');
    expect(markdown).toContain('- Check GPU');
    expect(sectionsFromMarkdown(markdown)).toEqual([
      { heading: 'Goal', body: 'Find the drop.' },
      { heading: 'Inputs', body: 'Capture A.' },
    ]);
  });
});
