import { useMemo } from 'react';
import type { RuntimeLogEntry } from '@shared/types/runtimeLog';
import {
  type RuntimeNamespaceFilter,
  type RuntimeSeverityFilter,
  type TerminalScopeFilter,
} from '../../../stores/terminalStore';
import { type SelectOption } from '../../../ui/Select';
import type { useI18n } from '../../../i18n';
import { formatShortId, stringifyEntryForSearch } from './terminalFormatters';

type Translate = ReturnType<typeof useI18n>['t'];

export function useTerminalDrawerOptions(t: Translate, activeRunId: string | null) {
  const scopeOptions = useMemo<SelectOption[]>(() => ([
    { value: 'current-session', label: t('terminal.scopeCurrentSession') },
    { value: 'current-run', label: t('terminal.scopeCurrentRun'), disabled: !activeRunId },
    { value: 'app', label: t('terminal.scopeApp') },
    { value: 'all-sessions', label: t('terminal.scopeAllSessions') },
  ]), [activeRunId, t]);

  const namespaceOptions = useMemo<SelectOption[]>(() => ([
    { value: 'all', label: t('terminal.namespaceAll') },
    { value: 'system', label: t('terminal.namespaceSystem') },
    { value: 'agent', label: t('terminal.namespaceAgent') },
    { value: 'tool', label: t('terminal.namespaceTool') },
    { value: 'device', label: t('terminal.namespaceDevice') },
    { value: 'capture', label: t('terminal.namespaceCapture') },
    { value: 'context', label: t('terminal.namespaceContext') },
    { value: 'llm', label: t('terminal.namespaceLlm') },
  ]), [t]);

  const severityOptions = useMemo<SelectOption[]>(() => ([
    { value: 'all', label: t('terminal.severityAll') },
    { value: 'error', label: t('terminal.severityError') },
    { value: 'warning', label: t('terminal.severityWarning') },
    { value: 'success', label: t('terminal.severitySuccess') },
    { value: 'info', label: t('terminal.severityInfo') },
  ]), [t]);

  const densityOptions = useMemo<SelectOption[]>(() => ([
    { value: 'compact', label: t('terminal.densityCompact') },
    { value: 'expanded', label: t('terminal.densityExpanded') },
  ]), [t]);

  return { scopeOptions, namespaceOptions, severityOptions, densityOptions };
}

export function useTerminalDrawerFilteredEntries(
  entries: RuntimeLogEntry[],
  namespaceFilter: RuntimeNamespaceFilter,
  severityFilter: RuntimeSeverityFilter,
  query: string,
) {
  return useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return entries.filter((entry) => {
      if (namespaceFilter !== 'all' && entry.namespace !== namespaceFilter) {
        return false;
      }

      if (severityFilter !== 'all' && entry.severity !== severityFilter) {
        return false;
      }

      if (normalizedQuery && !stringifyEntryForSearch(entry).includes(normalizedQuery)) {
        return false;
      }

      return true;
    });
  }, [entries, namespaceFilter, query, severityFilter]);
}

export function useTerminalDrawerContextCopy(options: {
  t: Translate;
  scopeFilter: TerminalScopeFilter;
  activeSessionId: string | null;
  activeRunId: string | null;
  scopeOptions: SelectOption[];
}) {
  const { t, scopeFilter, activeSessionId, activeRunId, scopeOptions } = options;

  const effectiveScopeFilter = useMemo<TerminalScopeFilter>(() => {
    if (!activeSessionId && (scopeFilter === 'current-session' || scopeFilter === 'current-run')) {
      return 'app';
    }
    return scopeFilter;
  }, [activeSessionId, scopeFilter]);

  const scopeLabel = scopeOptions.find((option) => option.value === effectiveScopeFilter)?.label ?? t('terminal.scopeCurrentSession');

  const titleContext = useMemo(() => {
    if (effectiveScopeFilter === 'app') {
      return t('terminal.scopeApp');
    }
    if (effectiveScopeFilter === 'all-sessions') {
      return t('terminal.scopeAllSessions');
    }
    if (effectiveScopeFilter === 'current-run') {
      return activeRunId
        ? `${scopeLabel} · ${formatShortId(activeRunId)}`
        : scopeLabel;
    }
    return activeSessionId
      ? `${scopeLabel} · ${formatShortId(activeSessionId)}`
      : t('terminal.scopeApp');
  }, [activeRunId, activeSessionId, effectiveScopeFilter, scopeLabel, t]);

  const emptyCopy = useMemo(() => {
    if (effectiveScopeFilter === 'current-run') {
      return activeRunId ? t('terminal.emptyRun') : t('terminal.emptyRunHint');
    }
    if (effectiveScopeFilter === 'current-session') {
      return activeSessionId ? t('terminal.emptySession') : t('terminal.emptySessionHint');
    }
    if (effectiveScopeFilter === 'app') {
      return t('terminal.emptyApp');
    }
    return t('terminal.emptyAllSessions');
  }, [activeRunId, activeSessionId, effectiveScopeFilter, t]);

  return { effectiveScopeFilter, titleContext, emptyCopy };
}
