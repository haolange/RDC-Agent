import { create } from 'zustand';
import type { AgentPermissionMode } from '@shared/types/settings';
import type { RuntimePermissionState } from '@shared/types/runtimePermission';

interface RuntimePermissionStore {
  snapshot: RuntimePermissionState | null;
  pendingMode: AgentPermissionMode | null;
  error: boolean;
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
    set({ pendingMode: mode, error: false });
    try {
      await window.electronAPI.settings.set({ agentRuntime: { permissions: { mode } } });
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
      if (request === requestRevision) set({ pendingMode: null, error: confirmed?.mode !== mode });
      if (confirmed?.mode === mode) return get().snapshot!;
      throw error;
    }
  },
}));
