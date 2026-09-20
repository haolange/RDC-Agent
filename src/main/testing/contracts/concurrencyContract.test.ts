/**
 * Concurrency contract — dual session turns, temporary path isolation.
 * Phase 7 matrix entry for TurnCoordinator / path root isolation.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import type { AgentEvent } from '@shared/types/agentRuntime';
import { TurnCoordinator } from '../../workflow/debugger/TurnCoordinator';
import { safeResolvePath } from '../../agent-runtime/tools/primitives/_shared';

function makeEvent(id: string, sessionId: string): AgentEvent {
  return {
    id,
    type: 'assistant.delta',
    timestamp: Date.now(),
    sessionId,
    agentId: 'ask',
    payload: { text: id },
  } as AgentEvent;
}

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

  it('replaces the active turn when the same session begins again', async () => {
    const coordinator = new TurnCoordinator();
    const first = await coordinator.beginTurn({
      sessionKey: 'session-edit',
      turnId: 't-1',
      eventSink: { sessionId: 'session-edit' },
    });
    const second = await coordinator.beginTurn({
      sessionKey: 'session-edit',
      turnId: 't-2',
      eventSink: { sessionId: 'session-edit' },
    });
    expect(coordinator.getActive('session-edit')).toBe(second);
    expect(second.generation).toBeGreaterThan(first.generation);
    expect(first.emitEvent(makeEvent('stale', 'session-edit'), first.generation)).toBe(false);
    await second.abortAndJoin({ reason: 'user_stop' });
  });
});

describe('concurrencyContract: temporary path roots', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('does not leak temporary roots across concurrent contexts', async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'rdc-conc-ws-'));
    const external = await mkdtemp(path.join(os.tmpdir(), 'rdc-conc-ext-'));
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


describe('concurrencyContract: orphan ownership', () => {
  it('fail-closed beginTurn while previous orphan is unsettled', async () => {
    const coordinator = new TurnCoordinator();
    const first = await coordinator.beginTurn({
      sessionKey: 'orphan-session',
      turnId: 't-orphan',
      eventSink: { sessionId: 'orphan-session' },
    });
    let resolveJoin!: () => void;
    const joinPromise = new Promise<void>((resolve) => { resolveJoin = resolve; });
    first.registerProducer({
      id: 'hang',
      abort: () => undefined,
      join: () => joinPromise,
    });
    await first.abortAndJoin({ reason: 'user_stop', graceMs: 5, forceAfterMs: 5 });
    expect(first.isOrphaned).toBe(true);
    coordinator.endTurn(first);
    await expect(coordinator.beginTurn({
      sessionKey: 'orphan-session',
      turnId: 't-next',
    })).rejects.toThrow(/TURN_ORPHANED/);
    resolveJoin();
    await first.whenSettled();
    await new Promise((r) => setTimeout(r, 10));
    const next = await coordinator.beginTurn({
      sessionKey: 'orphan-session',
      turnId: 't-next',
    });
    expect(next.turnId).toBe('t-next');
    await next.abortAndJoin({ reason: 'user_stop' });
  });
});
