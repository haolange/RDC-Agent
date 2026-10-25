import { afterEach, describe, expect, it, vi } from 'vitest';
import { setImmediate } from 'node:timers/promises';
import { listenGrokCallback } from './grokCallback';
import type { OAuthFlowState } from './oauthTypes';

const flows: OAuthFlowState[] = [];
const createFlow = (): OAuthFlowState => {
  const flow: OAuthFlowState = { providerId: 'grok-account', flowId: 'attempt', state: 'state',
    expiresAt: Date.now() + 60_000, abortController: new AbortController() };
  flows.push(flow); return flow;
};
afterEach(async () => {
  for (const flow of flows.splice(0)) flow.abortController?.abort();
  await setImmediate(); vi.useRealTimers();
});

describe('Grok callback lifecycle', () => {
  it('rejects incorrect state and expired callbacks without exchanging a code', async () => {
    const flow = createFlow(); const complete = vi.fn();
    await listenGrokCallback(flow, complete);
    expect((await fetch(`${flow.redirectUri}?state=wrong&code=code`)).status).toBe(400);
    flow.expiresAt = Date.now() - 1;
    expect((await fetch(`${flow.redirectUri}?state=state&code=code`)).status).toBe(410);
    expect(complete).not.toHaveBeenCalled();
  });
  it('exchanges only once and closes after success or failure', async () => {
    for (const fails of [false, true]) {
      const flow = createFlow(); let finish!: () => void;
      const complete = vi.fn(() => new Promise<void>((resolve, reject) => {
        finish = () => fails ? reject(new Error('denied')) : resolve();
      }));
      await listenGrokCallback(flow, complete);
      const first = fetch(`${flow.redirectUri}?state=state&code=code`);
      while (!finish) await setImmediate();
      expect((await fetch(`${flow.redirectUri}?state=state&code=again`)).status).toBe(410);
      finish(); expect((await first).status).toBe(fails ? 400 : 200);
      expect(complete).toHaveBeenCalledTimes(1);
      await setImmediate(); expect(flow.server?.listening).toBe(false);
    }
  });
  it('times out and releases the listener without waiting for another request', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const flow = createFlow(); flow.expiresAt = Date.now() + 100;
    const complete = vi.fn(); await listenGrokCallback(flow, complete);
    await vi.advanceTimersByTimeAsync(100); await setImmediate();
    expect(flow.abortController?.signal.aborted).toBe(true);
    expect(flow.server?.listening).toBe(false);
    expect(flow.error).toContain('timed out'); expect(complete).not.toHaveBeenCalled();
  });
});
