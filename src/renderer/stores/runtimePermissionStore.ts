import { create } from 'zustand';
import { errorDetail } from '../lib/errorDetail';
import type { AgentPermissionMode } from '@shared/types/settings';
import type { RuntimePermissionState } from '@shared/types/runtimePermission';

interface RuntimePermissionStore {
  snapshot: RuntimePermissionState | null;
  pendingMode: AgentPermissionMode | null;
  error: boolean;
  /** The last switch main did not confirm, with its technical reason for「复制详情」; cleared by the next attempt. */
  failedSwitch: { mode: AgentPermissionMode; detail: string } | null;
  applySnapshot: (snapshot: RuntimePermissionState) => void;
  setSyncError: () => void;
  refresh: () => Promise<void>;
  saveMode: (mode: AgentPermissionMode) => Promise<RuntimePermissionState>;
}

let requestRevision = 0;

export const useRuntimePermissionStore = create<RuntimePermissionStore>((set, get) => ({
  snapshot: null,
  pendingMode: null,
  error: false,
  failedSwitch: null,
  applySnapshot: (snapshot) => set((state) => (
    state.snapshot && state.snapshot.revision >= snapshot.revision
      ? state
      : { snapshot, error: false }
  )),
  setSyncError: () => set({ error: true }),
  refresh: async () => {
    try {
      get().applySnapshot(await window.electronAPI.runtime.getPermissionState());
      set({ error: false });
    } catch (error) {
      set({ error: true });
      throw error;
    }
  },
  saveMode: async (mode) => {
    if (get().snapshot?.mode === mode && get().pendingMode === null) return get().snapshot!;
    const baselineRevision = get().snapshot?.revision ?? 0;
    const request = ++requestRevision;
    set({ pendingMode: mode, error: false, failedSwitch: null });
    try {
      await window.electronAPI.settings.patch([{ op: 'agentRuntime', value: { permissions: { mode } } }]);
      get().applySnapshot(await window.electronAPI.runtime.getPermissionState());
      if (request === requestRevision) set({ pendingMode: null, error: false });
      return get().snapshot!;
    } catch (error) {
      // A lost response must not roll back a mode which main has already committed.
      const observed = get().snapshot;
      let confirmed: RuntimePermissionState | null = observed && observed.revision > baselineRevision ? observed : null;
      try {
        confirmed = await window.electronAPI.runtime.getPermissionState();
        get().applySnapshot(confirmed);
      } catch { /* Keep the last confirmed snapshot; never infer an effective mode. */ }
      if (request === requestRevision) {
        set(confirmed?.mode === mode ? { pendingMode: null, error: false }
          : { pendingMode: null, error: true, failedSwitch: { mode, detail: errorDetail(error) } });
      }
      if (confirmed?.mode === mode) return get().snapshot!;
      throw error;
    }
  },
}));
