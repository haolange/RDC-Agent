/**
 * Concurrency contract — dual session turns, temporary path isolation.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { TurnCoordinator } from '../../workflow/debugger/TurnCoordinator';
import { safeResolvePath } from '../../agent-runtime/tools/primitives/_shared';

describe('concurrencyContract: dual session turns', () => {
  it('keeps independent active turns per session', async () => {
    const coordinator = new TurnCoordinator();
    const a = await coordinator.beginTurn({
      sessionKey: 'session-a',
      turnId: 't-a',
      eventSink: { sessionId: 'session-a' },
    });
    const b = await coordinator.beginTurn({
      sessionKey: 'session-b',
      turnId: 't-b',
      eventSink: { sessionId: 'session-b' },
    });
    expect(coordinator.getActive('session-a')).toBe(a);
    expect(coordinator.getActive('session-b')).toBe(b);
    expect(a.generation).not.toBe(b.generation);
    await a.abortAndJoin({ reason: 'user_stop' });
    expect(coordinator.getActive('session-b')).toBe(b);
    await b.abortAndJoin({ reason: 'user_stop' });
  });
});

describe('concurrencyContract: temporary path roots', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('does not leak temporary roots across concurrent contexts', async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'rdx-conc-ws-'));
    const external = await mkdtemp(path.join(os.tmpdir(), 'rdx-conc-ext-'));
    roots.push(workspace, external);
    const externalFile = path.join(external, 'notes.txt');
    await writeFile(externalFile, 'ok', 'utf8');

    const allowed = safeResolvePath(externalFile, workspace, {
      workspaceRoot: workspace,
      projectRootPath: workspace,
      projectId: null,
      sessionId: 's1',
      temporaryAllowedPathRoots: [external],
    });
    expect(allowed).toBe(path.resolve(externalFile));

    expect(() => safeResolvePath(externalFile, workspace, {
      workspaceRoot: workspace,
      projectRootPath: workspace,
      projectId: null,
      sessionId: 's2',
      temporaryAllowedPathRoots: [],
    })).toThrow(/超出 workspace/);
  });
});
