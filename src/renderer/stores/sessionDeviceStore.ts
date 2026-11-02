import { create } from 'zustand';
import { acceptsReplayState } from '../lib/captureReplayIdentity';
import type { CaptureReplayState, DevicePreparationResult } from '@shared/types/captureReplay';
import type { SessionScope } from '@shared/types/session';
import type { ReplayDeviceIssue } from '@shared/types/device';

export const sessionDeviceKey = (scope: SessionScope) => `${scope.projectId}:${scope.sessionId}`;
type Confirmation = { scope: SessionScope; deviceId: string; result: DevicePreparationResult };
interface SessionDeviceStore {
  states: Record<string, CaptureReplayState>;
  errors: Record<string, string | null>;
  actionFailures: Record<string, { issue: ReplayDeviceIssue; deviceId: string } | null>;
  confirmation: Confirmation | null;
  confirming: boolean;
  receive: (state: CaptureReplayState) => void;
  load: (scope: SessionScope) => Promise<void>;
  prepare: (scope: SessionScope, deviceId: string, confirmationToken?: string) => Promise<void>;
  cancel: (scope: SessionScope) => Promise<void>;
  confirm: () => Promise<void>;
  dismissConfirmation: () => void;
}
const loads = new Map<string, Promise<void>>();
const intents = new Map<string, number>();

export const useSessionDeviceStore = create<SessionDeviceStore>((set, get) => ({
  states: {}, errors: {}, actionFailures: {}, confirmation: null, confirming: false,
  receive: (next) => set((state) => {
    const key = sessionDeviceKey(next); const current = state.states[key];
    if (!acceptsReplayState(current ?? null, next, next)) return state;
    if (current?.generation === next.generation && current.revision === next.revision) return state;
    return { states: { ...state.states, [key]: next }, errors: { ...state.errors, [key]: null }, actionFailures: { ...state.actionFailures, [key]: null } };
  }),
  load: (scope) => {
    const key = sessionDeviceKey(scope); const pending = loads.get(key);
    if (pending) return pending;
    const task = window.electronAPI.capture.getReplayState(scope).then(get().receive).catch((error) => {
      set((state) => ({ errors: { ...state.errors, [key]: String(error instanceof Error ? error.message : error) } }));
    }).finally(() => { loads.delete(key); });
    loads.set(key, task); return task;
  },
  prepare: async (scope, deviceId, confirmationToken) => {
    const key = sessionDeviceKey(scope);
    const intent = (intents.get(key) ?? 0) + 1;
    intents.set(key, intent);
    set((state) => ({ errors: { ...state.errors, [key]: null }, actionFailures: { ...state.actionFailures, [key]: null } }));
    if (!get().states[key]) await get().load(scope);
    const current = get().states[key]; if (!current) return;
    try {
      const result = await window.electronAPI.device.prepare({ ...scope, deviceId, bindingGeneration: current.generation, ...(confirmationToken ? { confirmationToken } : {}) });
      get().receive(result.state);
      if (intents.get(key) === intent) set((state) => ({
        confirmation: result.confirmation ? { scope, deviceId, result } : null,
        actionFailures: { ...state.actionFailures, [key]: result.error && !result.state.preparation.issue && !result.confirmation ? { issue: result.error, deviceId } : null },
      }));
    } catch (error) {
      if (intents.get(key) === intent) set((state) => ({ errors: { ...state.errors, [key]: String(error instanceof Error ? error.message : error) } }));
    }
  },
  cancel: async (scope) => {
    const current = get().states[sessionDeviceKey(scope)]; if (!current) return;
    intents.set(sessionDeviceKey(scope), (intents.get(sessionDeviceKey(scope)) ?? 0) + 1);
    set({ confirmation: null });
    try {
      const result = await window.electronAPI.device.cancelPreparation({ ...scope, bindingGeneration: current.generation });
      get().receive(result.state);
    } catch (error) {
      const key = sessionDeviceKey(scope);
      set((state) => ({ errors: { ...state.errors, [key]: String(error instanceof Error ? error.message : error) } }));
    }
  },
  confirm: async () => {
    const pending = get().confirmation; if (!pending?.result.confirmation || get().confirming) return;
    set({ confirming: true, confirmation: null });
    try { await get().prepare(pending.scope, pending.deviceId, pending.result.confirmation.token); }
    finally { set({ confirming: false }); }
  },
  dismissConfirmation: () => set({ confirmation: null }),
}));
