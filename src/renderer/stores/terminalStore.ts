import { create } from 'zustand';
import type {
  RuntimeLogEntry,
  RuntimeLogNamespace,
  RuntimeLogSeverity,
} from '@shared/types/runtimeLog';

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
  scopeFilter: TerminalScopeFilter;
  namespaceFilter: RuntimeNamespaceFilter;
  severityFilter: RuntimeSeverityFilter;
  density: TerminalDensity;
  query: string;
  followOutput: boolean;
  expandedEntryIds: string[];
  entries: RuntimeLogEntry[];
  isLoading: boolean;

  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
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

export const useTerminalStore = create<TerminalState>((set, get) => ({
  isOpen: false,
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

  setOpen: (open) => set({ isOpen: open }),
  toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),
  setActiveContext: (context) => set((state) => {
    const sessionId = Object.prototype.hasOwnProperty.call(context, 'sessionId')
      ? context.sessionId ?? null
      : state.sessionId;
    const projectId = Object.prototype.hasOwnProperty.call(context, 'projectId')
      ? context.projectId ?? null
      : state.projectId;
    const runId = Object.prototype.hasOwnProperty.call(context, 'runId')
      ? context.runId ?? null
      : state.runId;
    const changed = sessionId !== state.sessionId
      || projectId !== state.projectId
      || runId !== state.runId;

    return {
      sessionId,
      projectId,
      runId,
      entries: changed ? [] : state.entries,
      expandedEntryIds: changed ? [] : state.expandedEntryIds,
      isLoading: changed ? false : state.isLoading,
    };
  }),
  setActiveSessionId: (sessionId) => set((state) => ({
    sessionId,
    entries: sessionId === state.sessionId ? state.entries : [],
    expandedEntryIds: sessionId === state.sessionId ? state.expandedEntryIds : [],
    isLoading: sessionId === state.sessionId ? state.isLoading : false,
  })),
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
    const requestContext: TerminalContext = {
      sessionId: state.sessionId,
      projectId: state.projectId,
      runId: state.runId,
    };
    const requestScopeFilter = state.scopeFilter;
    const request = resolveRuntimeLogRequest(requestScopeFilter, requestContext.sessionId);
    set({ isLoading: true });
    try {
      const result = await electronAPI.runtimeLog.list(request);
      const latest = get();
      const requestIsCurrent = latest.scopeFilter === requestScopeFilter
        && latest.sessionId === requestContext.sessionId
        && latest.projectId === requestContext.projectId
        && latest.runId === requestContext.runId;
      if (!requestIsCurrent) {
        return;
      }
      const context = {
        sessionId: latest.sessionId,
        projectId: latest.projectId,
        runId: latest.runId,
      };
      set({
        entries: (result.entries ?? []).filter((entry) => matchesScopeFilter(entry, requestScopeFilter, context)),
        isLoading: false,
      });
    } catch {
      const latest = get();
      const requestIsCurrent = latest.scopeFilter === requestScopeFilter
        && latest.sessionId === requestContext.sessionId
        && latest.projectId === requestContext.projectId
        && latest.runId === requestContext.runId;
      if (!requestIsCurrent) {
        return;
      }
      set({
        entries: [],
        isLoading: false,
      });
    }
  },
}));
