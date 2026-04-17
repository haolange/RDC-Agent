import { create } from 'zustand';
import type {
  RuntimeLogDetailLevel,
  RuntimeLogEntry,
  RuntimeLogNamespace,
  RuntimeLogScope,
} from '@shared/types/runtimeLog';
import type {
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalTabRecord,
} from '@shared/types/terminal';

export const TERMINAL_LOGS_TAB_ID = 'terminal-logs';

type RuntimeNamespaceFilter = RuntimeLogNamespace | 'all';

interface TerminalState {
  isOpen: boolean;
  activeSessionId: string | null;
  scope: RuntimeLogScope;
  namespace: RuntimeNamespaceFilter;
  detailLevel: RuntimeLogDetailLevel;
  entries: RuntimeLogEntry[];
  isLoading: boolean;
  tabs: TerminalTabRecord[];
  activeTabId: string;
  shellBuffers: Record<string, string>;

  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  setActiveSessionId: (sessionId: string | null) => void;
  setScope: (scope: RuntimeLogScope) => void;
  setNamespace: (namespace: RuntimeNamespaceFilter) => void;
  setDetailLevel: (detailLevel: RuntimeLogDetailLevel) => void;
  appendEntry: (entry: RuntimeLogEntry) => void;
  refreshEntries: () => Promise<void>;
  syncTabs: (tabs: TerminalTabRecord[]) => void;
  refreshTabs: () => Promise<void>;
  ensureShellTab: (cwd?: string | null) => Promise<void>;
  createShellTab: (cwd?: string | null) => Promise<void>;
  activateTab: (tabId: string) => Promise<void>;
  closeShellTab: (tabId: string) => Promise<void>;
  appendTerminalData: (payload: TerminalDataEvent) => void;
  markTerminalExit: (payload: TerminalExitEvent) => void;
}

const shouldAppendEntry = (
  scope: RuntimeLogScope,
  activeSessionId: string | null,
  entry: RuntimeLogEntry,
): boolean => {
  if (scope === 'app') {
    return entry.scope === 'app';
  }

  return entry.scope === 'session' && entry.sessionId === activeSessionId;
};

const resolveNextActiveTabId = (
  currentActiveTabId: string,
  nextTabs: TerminalTabRecord[],
): string => {
  if (currentActiveTabId === TERMINAL_LOGS_TAB_ID) {
    return TERMINAL_LOGS_TAB_ID;
  }

  if (nextTabs.some((tab) => tab.tabId === currentActiveTabId)) {
    return currentActiveTabId;
  }

  return nextTabs[0]?.tabId ?? TERMINAL_LOGS_TAB_ID;
};

export const useTerminalStore = create<TerminalState>((set, get) => ({
  isOpen: false,
  activeSessionId: null,
  scope: 'session',
  namespace: 'all',
  detailLevel: 'summary',
  entries: [],
  isLoading: false,
  tabs: [],
  activeTabId: TERMINAL_LOGS_TAB_ID,
  shellBuffers: {},

  setOpen: (open) => set({ isOpen: open }),
  toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),
  setActiveSessionId: (activeSessionId) => set({ activeSessionId }),
  setScope: (scope) => set({ scope }),
  setNamespace: (namespace) => set({ namespace }),
  setDetailLevel: (detailLevel) => set({ detailLevel }),

  appendEntry: (entry) => {
    const state = get();
    if (!shouldAppendEntry(state.scope, state.activeSessionId, entry)) {
      return;
    }

    set((current) => ({
      entries: [...current.entries, entry],
    }));
  },

  refreshEntries: async () => {
    const electronAPI = window.electronAPI;
    if (!electronAPI) {
      return;
    }

    const { scope, activeSessionId } = get();
    set({ isLoading: true });
    try {
      const result = await electronAPI.runtimeLog.list({
        scope,
        sessionId: scope === 'session' ? activeSessionId : null,
      });
      set({
        entries: result.entries ?? [],
        isLoading: false,
      });
    } catch {
      set({
        entries: [],
        isLoading: false,
      });
    }
  },

  syncTabs: (tabs) => set((state) => ({
    tabs,
    activeTabId: resolveNextActiveTabId(state.activeTabId, tabs),
  })),

  refreshTabs: async () => {
    const electronAPI = window.electronAPI;
    if (!electronAPI) {
      return;
    }

    const result = await electronAPI.terminal.listTabs();
    get().syncTabs(result.tabs ?? []);
  },

  ensureShellTab: async (cwd) => {
    const electronAPI = window.electronAPI;
    if (!electronAPI) {
      return;
    }

    const state = get();
    if (state.tabs.length > 0) {
      if (state.activeTabId === TERMINAL_LOGS_TAB_ID) {
        set({ activeTabId: state.tabs[0].tabId });
      }
      return;
    }

    const result = await electronAPI.terminal.createTab({ cwd: cwd ?? null });
    get().syncTabs(result.tabs ?? []);
    if (result.tab) {
      set({ activeTabId: result.tab.tabId });
    }
  },

  createShellTab: async (cwd) => {
    const electronAPI = window.electronAPI;
    if (!electronAPI) {
      return;
    }

    const result = await electronAPI.terminal.createTab({ cwd: cwd ?? null });
    get().syncTabs(result.tabs ?? []);
    if (result.tab) {
      set({ activeTabId: result.tab.tabId });
    }
  },

  activateTab: async (tabId) => {
    if (tabId === TERMINAL_LOGS_TAB_ID) {
      set({ activeTabId: tabId });
      return;
    }

    const electronAPI = window.electronAPI;
    if (!electronAPI) {
      return;
    }

    const result = await electronAPI.terminal.activateTab(tabId);
    get().syncTabs(result.tabs ?? []);
    set({ activeTabId: tabId });
  },

  closeShellTab: async (tabId) => {
    const electronAPI = window.electronAPI;
    if (!electronAPI) {
      return;
    }

    const result = await electronAPI.terminal.closeTab(tabId);
    set((state) => {
      const nextBuffers = { ...state.shellBuffers };
      delete nextBuffers[tabId];
      return {
        shellBuffers: nextBuffers,
      };
    });
    get().syncTabs(result.tabs ?? []);
  },

  appendTerminalData: ({ tabId, data }) => set((state) => ({
    shellBuffers: {
      ...state.shellBuffers,
      [tabId]: `${state.shellBuffers[tabId] ?? ''}${data}`,
    },
  })),

  markTerminalExit: ({ tabId, exitCode }) => set((state) => ({
    tabs: state.tabs.map((tab) => (
      tab.tabId === tabId
        ? {
          ...tab,
          status: 'exited',
          exitCode,
        }
        : tab
    )),
    shellBuffers: {
      ...state.shellBuffers,
      [tabId]: `${state.shellBuffers[tabId] ?? ''}\r\n[process exited${exitCode == null ? '' : `: ${exitCode}`}]\r\n`,
    },
  })),
}));
