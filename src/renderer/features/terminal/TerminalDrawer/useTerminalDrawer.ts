import { useCallback, useEffect, useRef, useState } from 'react';
import type { RuntimeLogEntry } from '@shared/types/runtimeLog';
import { useI18n } from '../../../i18n';
import { useTerminalStore } from '../../../stores/terminalStore';
import { buildEntryCopy } from './terminalFormatters';
import {
  useTerminalDrawerContextCopy,
  useTerminalDrawerFilteredEntries,
  useTerminalDrawerOptions,
} from './terminalDrawerDerived';
import { useTerminalDrawerResize } from './useTerminalDrawerResize';

export function useTerminalDrawer() {
  const { t } = useI18n();
  const resize = useTerminalDrawerResize();

  const activityBodyRef = useRef<HTMLDivElement>(null);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const isOpen = useTerminalStore((state) => state.isOpen);
  const scopeFilter = useTerminalStore((state) => state.scopeFilter);
  const namespaceFilter = useTerminalStore((state) => state.namespaceFilter);
  const severityFilter = useTerminalStore((state) => state.severityFilter);
  const density = useTerminalStore((state) => state.density);
  const query = useTerminalStore((state) => state.query);
  const followOutput = useTerminalStore((state) => state.followOutput);
  const expandedEntryIds = useTerminalStore((state) => state.expandedEntryIds);
  const activeSessionId = useTerminalStore((state) => state.sessionId);
  const activeRunId = useTerminalStore((state) => state.runId);
  const entries = useTerminalStore((state) => state.entries);
  const isLoading = useTerminalStore((state) => state.isLoading);
  const setScopeFilter = useTerminalStore((state) => state.setScopeFilter);
  const setNamespaceFilter = useTerminalStore((state) => state.setNamespaceFilter);
  const setSeverityFilter = useTerminalStore((state) => state.setSeverityFilter);
  const setDensity = useTerminalStore((state) => state.setDensity);
  const setQuery = useTerminalStore((state) => state.setQuery);
  const setFollowOutput = useTerminalStore((state) => state.setFollowOutput);
  const toggleEntryExpanded = useTerminalStore((state) => state.toggleEntryExpanded);
  const refreshEntries = useTerminalStore((state) => state.refreshEntries);

  const { scopeOptions, namespaceOptions, severityOptions, densityOptions } = useTerminalDrawerOptions(t, activeRunId);
  const filteredEntries = useTerminalDrawerFilteredEntries(entries, namespaceFilter, severityFilter, query);
  const { effectiveScopeFilter, titleContext, emptyCopy } = useTerminalDrawerContextCopy({
    t,
    scopeFilter,
    activeSessionId,
    activeRunId,
    scopeOptions,
  });

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    void refreshEntries();
  }, [activeRunId, activeSessionId, isOpen, refreshEntries, scopeFilter]);

  useEffect(() => {
    if (!followOutput) {
      return;
    }
    const body = activityBodyRef.current;
    if (!body) {
      return;
    }
    body.scrollTop = body.scrollHeight;
  }, [filteredEntries.length, followOutput]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const targetElement = event.target as Element | null;
      if (
        filterMenuRef.current?.contains(target)
        || targetElement?.closest?.('.dropdown-select-menu')
      ) {
        return;
      }
      setFiltersOpen(false);
    };

    if (filtersOpen) {
      document.addEventListener('mousedown', handlePointerDown);
    }

    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [filtersOpen]);

  const handleCopyEntry = useCallback((entry: RuntimeLogEntry) => {
    void window.electronAPI?.appShell.copyText(buildEntryCopy(entry));
  }, []);

  const closeTerminal = useCallback(() => {
    useTerminalStore.getState().toggleOpen();
  }, []);

  return {
    t,
    terminalHeight: resize.terminalHeight,
    activityBodyRef,
    filterMenuRef,
    filtersOpen,
    setFiltersOpen,
    isResizing: resize.isResizing,
    isOpen,
    namespaceFilter,
    severityFilter,
    density,
    query,
    followOutput,
    expandedEntryIds,
    effectiveScopeFilter,
    scopeOptions,
    namespaceOptions,
    severityOptions,
    densityOptions,
    filteredEntries,
    isLoading,
    titleContext,
    emptyCopy,
    setScopeFilter,
    setNamespaceFilter,
    setSeverityFilter,
    setDensity,
    setQuery,
    setFollowOutput,
    toggleEntryExpanded,
    handleResizePointerDown: resize.handleResizePointerDown,
    handleResizeDoubleClick: resize.handleResizeDoubleClick,
    handleCopyEntry,
    closeTerminal,
  };
}

export type TerminalDrawerViewModel = ReturnType<typeof useTerminalDrawer>;
