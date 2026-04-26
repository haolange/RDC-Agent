import { create } from 'zustand';
import type {
  RuntimeLogEntry,
  RuntimeLogNamespace,
  RuntimeLogSeverity,
} from '@shared/types/runtimeLog';
import type {
  TerminalCreateTabRequest,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalTabRecord,
} from '@shared/types/terminal';

export type TerminalView = 'activity' | 'shell';
export type TerminalScopeFilter = 'current-session' | 'current-run' | 'app' | 'all-sessions';
export type RuntimeNamespaceFilter = RuntimeLogNamespace | 'all';
export type RuntimeSeverityFilter = RuntimeLogSeverity | 'all';
export type TerminalDensity = 'compact' | 'expanded';

interface TerminalContext {
  sessionId: string | null;
  projectId: string | null;
  runId: string | null;
}

interface TerminalState extends TerminalContext {
  isOpen: boolean;
  view: TerminalView;
  scopeFilter: TerminalScopeFilter;
  namespaceFilter: RuntimeNamespaceFilter;
  severityFilter: RuntimeSeverityFilter;
  density: TerminalDensity;
  query: string;
  followOutput: boolean;
  expandedEntryIds: string[];
  entries: RuntimeLogEntry[];
  isLoading: boolean;
  tabs: TerminalTabRecord[];
  activeTabId: string | null;
  shellBuffers: Record<string, string>;

  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  setView: (view: TerminalView) => void;
  setActiveContext: (context: Partial<TerminalContext>) => void;
  setActiveSessionId: (sessionId: string | null) => void;
  setScopeFilter: (scopeFilter: TerminalScopeFilter) => void;
  setNamespaceFilter: (namespaceFilter: RuntimeNamespaceFilter) => void;
  setSeverityFilter: (severityFilter: RuntimeSeverityFilter) => void;
  setDensity: (density: TerminalDensity) => void;
  setQuery: (query: string) => void;
  setFollowOutput: (followOutput: boolean) => void;
  toggleEntryExpanded: (entryId: string) => void;
  appendEntry: (entry: RuntimeLogEntry) => void;
  refreshEntries: () => Promise<void>;
  syncTabs: (tabs: TerminalTabRecord[]) => void;
  refreshTabs: () => Promise<void>;
  createShellTab: (request?: TerminalCreateTabRequest) => Promise<void>;
  activateTab: (tabId: string) => Promise<void>;
  closeShellTab: (tabId: string) => Promise<void>;
  clearShellBuffer: (tabId: string) => void;
  appendTerminalData: (payload: TerminalDataEvent) => void;
  markTerminalExit: (payload: TerminalExitEvent) => void;
}

const resolveRuntimeLogRequest = (
  scopeFilter: TerminalScopeFilter,
  sessionId: string | null,
): { scope: 'app' | 'session'; sessionId?: string | null } => {
  if ((scopeFilter === 'current-session' || scopeFilter === 'current-run') && sessionId) {
    return { scope: 'session', sessionId };
  }

  return { scope: 'app', sessionId: null };
};

const matchesScopeFilter = (
  entry: RuntimeLogEntry,
  scopeFilter: TerminalScopeFilter,
  context: TerminalContext,
): boolean => {
  if (scopeFilter === 'app') {
    return entry.scope === 'app';
  }

  if (scopeFilter === 'all-sessions') {
    return true;
  }

  if (!context.sessionId) {
    return entry.scope === 'app';
  }

  if (entry.scope !== 'session' || entry.sessionId !== context.sessionId) {
    return false;
  }

  if (scopeFilter === 'current-run') {
    return Boolean(context.runId) && entry.runId === context.runId;
  }

  return true;
};

const resolveNextActiveTabId = (
  currentActiveTabId: string | null,
  nextTabs: TerminalTabRecord[],
): string | null => {
  if (currentActiveTabId && nextTabs.some((tab) => tab.tabId === currentActiveTabId)) {
    return currentActiveTabId;
  }

  return nextTabs.find((tab) => tab.kind === 'shell')?.tabId ?? null;
};

export const useTerminalStore = create<TerminalState>((set, get) => ({
  isOpen: false,
  view: 'activity',
  scopeFilter: 'current-session',
  namespaceFilter: 'all',
  severityFilter: 'all',
  density: 'compact',
  query: '',
  followOutput: true,
  expandedEntryIds: [],
  sessionId: null,
  projectId: null,
  runId: null,
  entries: [],
  isLoading: false,
  tabs: [],
  activeTabId: null,
  shellBuffers: {},

  setOpen: (open) => set({ isOpen: open }),
  toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),
  setView: (view) => set({ view }),
  setActiveContext: (context) => set((state) => ({
    sessionId: Object.prototype.hasOwnProperty.call(context, 'sessionId') ? context.sessionId ?? null : state.sessionId,
    projectId: Object.prototype.hasOwnProperty.call(context, 'projectId') ? context.projectId ?? null : state.projectId,
    runId: Object.prototype.hasOwnProperty.call(context, 'runId') ? context.runId ?? null : state.runId,
  })),
  setActiveSessionId: (sessionId) => set({ sessionId }),
  setScopeFilter: (scopeFilter) => set({ scopeFilter, expandedEntryIds: [] }),
  setNamespaceFilter: (namespaceFilter) => set({ namespaceFilter }),
  setSeverityFilter: (severityFilter) => set({ severityFilter }),
  setDensity: (density) => set({ density }),
  setQuery: (query) => set({ query }),
  setFollowOutput: (followOutput) => set({ followOutput }),
  toggleEntryExpanded: (entryId) => set((state) => ({
    expandedEntryIds: state.expandedEntryIds.includes(entryId)
      ? state.expandedEntryIds.filter((id) => id !== entryId)
      : [...state.expandedEntryIds, entryId],
  })),

  appendEntry: (entry) => {
    const state = get();
    if (!matchesScopeFilter(entry, state.scopeFilter, state)) {
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

    const state = get();
    const request = resolveRuntimeLogRequest(state.scopeFilter, state.sessionId);
    set({ isLoading: true });
    try {
      const result = await electronAPI.runtimeLog.list(request);
      const context = {
        sessionId: get().sessionId,
        projectId: get().projectId,
        runId: get().runId,
      };
      set({
        entries: (result.entries ?? []).filter((entry) => matchesScopeFilter(entry, get().scopeFilter, context)),
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

  createShellTab: async (request) => {
    const electronAPI = window.electronAPI;
    if (!electronAPI) {
      return;
    }

    const state = get();
    const result = await electronAPI.terminal.createTab({
      cwd: request?.cwd ?? null,
      sessionId: request?.sessionId ?? state.sessionId,
      projectId: request?.projectId ?? state.projectId,
      runId: request?.runId ?? state.runId,
    });
    get().syncTabs(result.tabs ?? []);
    if (result.tab) {
      set({ activeTabId: result.tab.tabId, view: 'shell' });
    }
  },

  activateTab: async (tabId) => {
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

  clearShellBuffer: (tabId) => set((state) => ({
    shellBuffers: {
      ...state.shellBuffers,
      [tabId]: '',
    },
  })),

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
