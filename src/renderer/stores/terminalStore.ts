import { create } from 'zustand';
import type {
  RuntimeLogDetailLevel,
  RuntimeLogEntry,
  RuntimeLogNamespace,
  RuntimeLogScope,
} from '@shared/types/runtimeLog';

export type RuntimeTerminalNamespaceFilter = 'all' | RuntimeLogNamespace;

interface TerminalState {
  isOpen: boolean;
  scope: RuntimeLogScope;
  namespace: RuntimeTerminalNamespaceFilter;
  detailLevel: RuntimeLogDetailLevel;
  activeSessionId: string | null;
  entries: RuntimeLogEntry[];
  isLoading: boolean;
  toggleOpen: () => void;
  setOpen: (open: boolean) => void;
  setScope: (scope: RuntimeLogScope) => void;
  setNamespace: (namespace: RuntimeTerminalNamespaceFilter) => void;
  setDetailLevel: (detailLevel: RuntimeLogDetailLevel) => void;
  setActiveSessionId: (sessionId: string | null) => void;
  setEntries: (entries: RuntimeLogEntry[]) => void;
  appendEntry: (entry: RuntimeLogEntry) => void;
  refreshEntries: () => Promise<void>;
}

const trimToLimit = (entries: RuntimeLogEntry[], limit = 1000): RuntimeLogEntry[] =>
  entries.length > limit ? entries.slice(entries.length - limit) : entries;

export const useTerminalStore = create<TerminalState>((set, get) => ({
  isOpen: false,
  scope: 'session',
  namespace: 'all',
  detailLevel: 'summary',
  activeSessionId: null,
  entries: [],
  isLoading: false,

  toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),
  setOpen: (open) => set({ isOpen: open }),
  setScope: (scope) => set({ scope }),
  setNamespace: (namespace) => set({ namespace }),
  setDetailLevel: (detailLevel) => set({ detailLevel }),
  setActiveSessionId: (sessionId) => set({ activeSessionId: sessionId }),
  setEntries: (entries) => set({ entries: trimToLimit(entries), isLoading: false }),

  appendEntry: (entry) => set((state) => {
    const matchesScope = state.scope === 'app' || (Boolean(state.activeSessionId) && entry.sessionId === state.activeSessionId);
    if (!matchesScope) {
      return state;
    }

    return {
      entries: trimToLimit([...state.entries, entry]),
    };
  }),

  refreshEntries: async () => {
    const electronAPI = window.electronAPI;
    if (!electronAPI?.runtimeLog?.list) {
      set({ entries: [], isLoading: false });
      return;
    }

    set({ isLoading: true });
    try {
      const state = get();
      const result = await electronAPI.runtimeLog.list({
        scope: state.scope,
        sessionId: state.activeSessionId,
      });
      set({
        entries: trimToLimit(result.entries ?? []),
        isLoading: false,
      });
    } catch {
      set({ entries: [], isLoading: false });
    }
  },
}));
