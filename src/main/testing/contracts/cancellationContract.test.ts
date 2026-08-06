/**
 * Cancellation contract: abort leaves no live process and drops late events.
 * Phase 7 matrix entry for ProcessSupervisor / TurnHandle generation guards.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProcessSupervisor } from '../../runtime/ProcessSupervisor';
import { TurnCoordinator } from '../../workflow/debugger/TurnCoordinator';
import type { AgentEvent } from '@shared/types/agentRuntime';

function spawnLongRunning(supervisor: ProcessSupervisor) {
  return supervisor.spawn(
    'shell',
    process.execPath,
    ['-e', 'setInterval(() => undefined, 1000);'],
    { isolateProcessGroup: false },
  );
}

function makeEvent(id: string): AgentEvent {
  return {
    id,
    type: 'assistant.delta',
    timestamp: Date.now(),
    sessionId: 's1',
    agentId: 'ask',
    payload: { text: id },
  } as AgentEvent;
}

describe('cancellationContract: process abort', () => {
  let supervisor: ProcessSupervisor;

  beforeEach(() => {
    supervisor = new ProcessSupervisor();
  });

  afterEach(async () => {
    await supervisor.joinAll({ graceMs: 300, forceAfterMs: 1_500 });
    supervisor.resetForTests();
  });

  it('abort joins and clears registry (failure-class: availability)', async () => {
    const supervised = spawnLongRunning(supervisor);

    expect(supervisor.size).toBe(1);
    supervised.abort('abort');
    const info = await supervised.join(8_000);
    expect(info.reason).toBe('abort');
    expect(supervisor.size).toBe(0);
  }, 12_000);

  it('abortAll clears every active session turn', async () => {
    const coordinator = new TurnCoordinator();
    const a = await coordinator.beginTurn({
      sessionKey: 'cancel-a',
      turnId: 't-a',
      eventSink: { sessionId: 'cancel-a' },
    });
    const b = await coordinator.beginTurn({
      sessionKey: 'cancel-b',
      turnId: 't-b',
      eventSink: { sessionId: 'cancel-b' },
    });
    expect(coordinator.getActive('cancel-a')).toBe(a);
    expect(coordinator.getActive('cancel-b')).toBe(b);
    await coordinator.abortAll('user_stop');
    expect(coordinator.getActive('cancel-a')).toBeNull();
    expect(coordinator.getActive('cancel-b')).toBeNull();
  });
});

describe('cancellationContract: late events', () => {
  it('generation token drops events after abortAndJoin', async () => {
    const coordinator = new TurnCoordinator();
    const received: string[] = [];
    const handle = await coordinator.beginTurn({
      sessionKey: 'cancel-s',
      turnId: 't',
      eventSink: {
        onEvent: (e) => received.push(e.id),
        sessionId: 'cancel-s',
      },
    });
    const gen = handle.generation;
    expect(handle.emitEvent(makeEvent('early'), gen)).toBe(true);
    await handle.abortAndJoin({ reason: 'user_stop' });
    expect(handle.emitEvent(makeEvent('late'), gen)).toBe(false);
    expect(received).toEqual(['early']);
  });
});


describe('cancellationContract: dynamic producer join', () => {
  it('abortAndJoin waits for late-registered producer', async () => {
    const coordinator = new TurnCoordinator();
    const handle = await coordinator.beginTurn({
      sessionKey: 'late-prod',
      turnId: 't',
      eventSink: { sessionId: 'late-prod' },
    });
    let lateJoined = false;
    handle.registerProducer({
      id: 'seed',
      abort: () => {
        handle.registerProducer({
          id: 'late',
          abort: () => undefined,
          join: async () => {
            await new Promise((r) => setTimeout(r, 30));
            lateJoined = true;
          },
        });
      },
      join: async () => {
        await new Promise((r) => setTimeout(r, 5));
      },
    });
    await handle.abortAndJoin({ reason: 'user_stop', graceMs: 500, forceAfterMs: 1_000 });
    expect(lateJoined).toBe(true);
  });
});
