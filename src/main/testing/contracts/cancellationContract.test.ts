/**
 * Cancellation contract — abort leaves no live process and drops late events.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProcessSupervisor } from '../../runtime/ProcessSupervisor';
import { TurnCoordinator } from '../../workflow/debugger/TurnCoordinator';
import type { AgentEvent } from '@shared/types/agentRuntime';

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
    await supervisor.joinAll({ graceMs: 200, forceAfterMs: 1_000 });
    supervisor.resetForTests();
  });

  it('abort joins and clears registry (failure-class: availability)', async () => {
    const isWin = process.platform === 'win32';
    const supervised = isWin
      ? supervisor.spawn('shell', 'cmd.exe', ['/d', '/s', '/c', 'ping -n 30 127.0.0.1 >nul'], {
          isolateProcessGroup: false,
        })
      : supervisor.spawn('shell', '/bin/sleep', ['30']);

    expect(supervisor.size).toBe(1);
    supervised.abort('abort');
    const info = await supervised.join(5_000);
    expect(info.reason).toBe('abort');
    expect(supervisor.size).toBe(0);
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
