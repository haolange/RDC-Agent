import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRendererEvents } from './rendererEvents';
import type { RendererEventChannel } from './channels';
import type { RendererApiTransport, RendererEventCallback } from './transport';

function pushTransport() {
  const listeners = new Map<RendererEventChannel, Set<RendererEventCallback>>();
  const transport: RendererApiTransport = {
    invoke: async <TResult>() => undefined as TResult,
    subscribe: (channel, callback) => {
      transport.addListener(channel, callback);
      return () => transport.removeListener(channel, callback);
    },
    addListener: (channel, callback) => listeners.set(channel, (listeners.get(channel) ?? new Set()).add(callback)),
    removeListener: (channel, callback) => { listeners.get(channel)?.delete(callback); },
    removeAllListeners: (channel) => { listeners.delete(channel); },
  };
  const push = (channel: RendererEventChannel, payload: unknown) => {
    for (const callback of listeners.get(channel) ?? []) callback(payload);
  };
  return { transport, push };
}

describe('renderer events', () => {
  afterEach(() => vi.restoreAllMocks());

  it('hands listeners the payload main sent and drops one that breaks its channel contract with a diagnostic', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { transport, push } = pushTransport();
    const events = createRendererEvents(transport);
    const runStatus = vi.fn();
    const stream = vi.fn();
    events.subscribe('workflow:runStatusChanged', runStatus);
    events.add('conversation:event', stream);

    const status = { runId: 'run', sessionId: 'session', status: 'completed' };
    push('workflow:runStatusChanged', status);
    push('workflow:runStatusChanged', { runId: 'run', sessionId: 'session', status: 'exploded' });
    const delta = { type: 'message_delta', sessionId: 'session', turnId: 'turn',
      delta: { messageId: 'message', seq: 2, baseSeq: 1, fields: { content: 'Hi' } } };
    push('conversation:event', delta);
    push('conversation:event', { ...delta, delta: { ...delta.delta, seq: '3' } });

    expect(runStatus.mock.calls).toEqual([[status]]);
    expect(runStatus.mock.calls[0]?.[0]).toBe(status);
    expect(stream.mock.calls).toEqual([[delta]]);
    expect(warn.mock.calls.map(([message]) => message)).toEqual([
      '[ipc-event] dropped an invalid workflow:runStatusChanged payload',
      '[ipc-event] dropped an invalid conversation:event payload',
    ]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('exploded');

    events.remove('conversation:event', stream);
    push('conversation:event', delta);
    expect(stream).toHaveBeenCalledOnce();
  });
});
