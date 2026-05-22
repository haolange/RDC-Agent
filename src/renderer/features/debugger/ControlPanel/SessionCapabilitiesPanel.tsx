import React, { useEffect, useMemo, useState } from 'react';
import type { ToolRuntimeSummary } from '@shared/types/tool';
import { AGENT_DISPLAY_NAMES } from '@shared/constants/agents';
import { useI18n } from '../../../i18n';
import { useSessionStore } from '../../../stores/sessionStore';

const CORE_NAMESPACES = ['rd.event.*', 'rd.export.*', 'rd.session.*'];

export const SessionCapabilitiesPanel: React.FC = () => {
  const { t } = useI18n();
  const workflowState = useSessionStore((state) => state.workflowState);
  const currentDebugPlan = useSessionStore((state) => state.currentDebugPlan);
  const [summary, setSummary] = useState<ToolRuntimeSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const electronAPI = window.electronAPI;
    if (!electronAPI) {
      setError(t('control.sessionCapabilitiesUnavailable'));
      return () => {
        cancelled = true;
      };
    }

    void electronAPI.tool.getRuntimeSummary()
      .then((result) => {
        if (!cancelled) {
          setSummary(result);
          setError(null);
        }
      })
      .catch((failure) => {
        if (!cancelled) {
          setError(failure instanceof Error ? failure.message : String(failure));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [t]);

  const recommendedSpecialists = useMemo(() => {
    const fromPlan = currentDebugPlan?.recommendedSpecialists ?? workflowState?.debugPlan?.recommendedSpecialists ?? [];
    const fromRuntime = summary?.recommendedSpecialists ?? [];
    return (fromPlan.length > 0 ? fromPlan : fromRuntime).slice(0, 5);
  }, [currentDebugPlan?.recommendedSpecialists, summary?.recommendedSpecialists, workflowState?.debugPlan?.recommendedSpecialists]);

  const namespaces = useMemo(() => {
    const runtimeNamespaces = summary?.namespaces ?? [];
    return CORE_NAMESPACES.map((namespace) => (
      runtimeNamespaces.find((entry) => entry.namespace === namespace)
      ?? { namespace, toolCount: 0, available: false }
    ));
  }, [summary?.namespaces]);

  return (
    <div className="session-capabilities-panel" data-testid="session-capabilities-panel">
      <div className="session-capability-block">
        <span className="session-capability-label">{t('control.sessionCapabilitiesSpecialists')}</span>
        <div className="session-capability-chip-list">
          {recommendedSpecialists.length > 0 ? recommendedSpecialists.map((agentId) => (
            <span key={agentId} className="session-capability-chip">
              {AGENT_DISPLAY_NAMES[agentId as keyof typeof AGENT_DISPLAY_NAMES] || agentId}
            </span>
          )) : (
            <span className="session-capability-muted">{t('control.sessionCapabilitiesNoSpecialists')}</span>
          )}
        </div>
      </div>

      <div className="session-capability-runtime" data-testid="session-capability-cli-runtime">
        <span className={`session-capability-status-dot ${summary?.cli.available ? 'available' : 'unavailable'}`} />
        <span className="session-capability-runtime-copy">
          <span className="session-capability-runtime-title">
            {summary?.cli.available ? t('control.sessionCapabilitiesCliAvailable') : t('control.sessionCapabilitiesCliUnavailable')}
          </span>
          <span className="session-capability-runtime-detail">
            {summary
              ? `${summary.runtime.source} · ${summary.runtime.version ?? 'unknown'} · ${summary.runtime.catalog.exists ? 'catalog' : 'no catalog'}`
              : error ?? t('control.sessionCapabilitiesLoading')}
          </span>
          {!summary?.cli.available && summary?.cli.unavailableReason ? (
            <span className="session-capability-runtime-error">{summary.cli.unavailableReason}</span>
          ) : null}
        </span>
      </div>

      <div className="session-capability-namespace-list">
        {namespaces.map((entry) => (
          <div key={entry.namespace} className="session-capability-namespace">
            <span className="session-capability-namespace-name">{entry.namespace}</span>
            <span className={`session-capability-namespace-count ${entry.available ? 'available' : ''}`}>
              {entry.available
                ? t('control.sessionCapabilitiesNamespaceTools', { count: entry.toolCount })
                : t('control.sessionCapabilitiesNamespaceUnavailable')}
            </span>
          </div>
        ))}
      </div>

      {error ? <div className="session-capability-error">{error}</div> : null}
    </div>
  );
};

export default SessionCapabilitiesPanel;
