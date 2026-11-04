import { beforeEach, expect, it, vi } from 'vitest';
import { replayFixture } from '../testing/replayFixture';
import { sessionDeviceKey, useSessionDeviceStore } from './sessionDeviceStore';

const scope = { projectId: 'project', sessionId: 'session' };
beforeEach(() => {
  useSessionDeviceStore.setState({ states: {}, errors: {}, actionFailures: {}, confirmation: null, confirming: false });
  vi.stubGlobal('window', { electronAPI: { capture: {}, device: {} } });
});
it('keeps per-session main state and rejects old generations without falling back to Local', () => {
  const current = replayFixture({ generation: 3, preparation: { targetDeviceId: 'android', phase: 'failed', issue: { code: 'remote_busy', stage: 'checking', diagnostic: 'raw', recovery: 'retry' } } });
  useSessionDeviceStore.getState().receive(current);
  useSessionDeviceStore.getState().receive(replayFixture({ generation: 2, revision: 999 }));
  useSessionDeviceStore.getState().receive(replayFixture({ sessionId: 'other' }));
  expect(useSessionDeviceStore.getState().states[sessionDeviceKey(scope)]).toEqual(current);
});
it('preserves the old target until main confirms close, and returns its opaque token on confirmation', async () => {
  const original = replayFixture({ generation: 5 });
  const ready = replayFixture({ generation: 6, preparation: { targetDeviceId: 'android', phase: 'ready', issue: null } });
  const prepare = vi.fn().mockResolvedValueOnce({ success: false, state: original, confirmation: { token: 'opaque', kind: 'close_capture' } }).mockResolvedValueOnce({ success: true, state: ready });
  window.electronAPI.device.prepare = prepare;
  useSessionDeviceStore.getState().receive(original);
  await useSessionDeviceStore.getState().prepare(scope, 'android');
  expect(useSessionDeviceStore.getState().states[sessionDeviceKey(scope)].preparation.targetDeviceId).toBe('local');
  useSessionDeviceStore.getState().dismissConfirmation();
  expect(prepare).toHaveBeenCalledOnce();
  await useSessionDeviceStore.getState().prepare(scope, 'android');
  expect(useSessionDeviceStore.getState().states[sessionDeviceKey(scope)]).toEqual(ready);
});
it('resubmits a confirmation once, scoped to the main generation and selected device', async () => {
  const state = replayFixture({ generation: 7 });
  const prepare = vi.fn().mockResolvedValue({ success: true, state: replayFixture({ generation: 8 }) });
  window.electronAPI.device.prepare = prepare;
  useSessionDeviceStore.setState({ states: { [sessionDeviceKey(scope)]: state }, confirmation: { scope, deviceId: 'android', result: { success: false, state, confirmation: { token: 'once', kind: 'close_capture' } } } });
  await Promise.all([useSessionDeviceStore.getState().confirm(), useSessionDeviceStore.getState().confirm()]);
  expect(prepare).toHaveBeenCalledExactlyOnceWith({ ...scope, deviceId: 'android', bindingGeneration: 7, confirmationToken: 'once' });
});
it('does not surface a late confirmation from an earlier choice', async () => {
  let resolve!: (value: unknown) => void;
  window.electronAPI.device.prepare = vi.fn().mockReturnValueOnce(new Promise((done) => { resolve = done; })).mockResolvedValueOnce({ success: true, state: replayFixture({ generation: 3 }) });
  useSessionDeviceStore.getState().receive(replayFixture());
  const first = useSessionDeviceStore.getState().prepare(scope, 'android');
  await useSessionDeviceStore.getState().prepare(scope, 'local');
  resolve({ success: false, state: replayFixture({ generation: 2 }), confirmation: { token: 'stale', kind: 'close_capture' } });
  await first;
  expect(useSessionDeviceStore.getState().confirmation).toBeNull();
  expect(useSessionDeviceStore.getState().states[sessionDeviceKey(scope)].generation).toBe(3);
});
it('surfaces a typed rejected action without rewriting the current connection target', async () => {
  const state = replayFixture();
  const issue = { code: 'remote_busy', stage: 'checking' as const, diagnostic: 'owned by another session', recovery: 'retry' as const };
  window.electronAPI.device.prepare = vi.fn().mockResolvedValue({ success: false, state, error: issue });
  useSessionDeviceStore.getState().receive(state);
  await useSessionDeviceStore.getState().prepare(scope, 'android');
  expect(useSessionDeviceStore.getState().states[sessionDeviceKey(scope)].preparation.targetDeviceId).toBe('local');
  expect(useSessionDeviceStore.getState().actionFailures[sessionDeviceKey(scope)]).toEqual({ issue, deviceId: 'android' });
  useSessionDeviceStore.getState().receive({ ...state, revision: 2 });
  expect(useSessionDeviceStore.getState().actionFailures[sessionDeviceKey(scope)]).toBeNull();
});
it('disconnects the current scoped connection using its latest generation', async () => {
  window.electronAPI.device.cancelPreparation = vi.fn().mockResolvedValue({ success: true, state: replayFixture({ generation: 5 }) });
  useSessionDeviceStore.getState().receive(replayFixture({ generation: 4 }));
  await useSessionDeviceStore.getState().cancel(scope);
  expect(window.electronAPI.device.cancelPreparation).toHaveBeenCalledExactlyOnceWith({ ...scope, bindingGeneration: 4 });
});
