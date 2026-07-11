import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../../i18n';
import { useCaptureStore } from '../../../stores/captureStore';
import { useConversationStore } from '../../../stores/conversationStore';
import { useEvidenceStore } from '../../../stores/evidenceStore';
import { useProjectStore } from '../../../stores/projectStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useWorkflowStore } from '../../../stores/workflowStore';
import { getSessionContextSummary, SessionContextPanel } from './SessionContextPanel';
import { getSessionProgressSnapshot, SessionProgressPanel } from './SessionProgressPanel';
import { SessionCapabilitiesPanel } from './SessionCapabilitiesPanel';
import { RdxRuntimeContextPanel } from './RdxRuntimeContextPanel';
import { SessionWorkingFolderPanel } from './SessionWorkingFolderPanel';
import { ArtifactTree } from './ArtifactTree';
import { MemoryPanel } from './MemoryPanel';
import { CollapsibleSection } from './CollapsibleSection';
import { RequestInspector } from './RequestInspector';
import { useRequestInspectorTarget } from './useRequestInspectorTarget';

export const ClassicSessionControlPanel: React.FC = () => {
  const { t } = useI18n();
  const currentRun = useSessionStore((state) => state.currentRun);
  const workflowState = useWorkflowStore((state) => state.workflowState);
  const reasoningSummaries = useConversationStore((state) => state.reasoningSummaries);
  const currentSession = useProjectStore((state) => state.currentSession);
  const openedCapture = useCaptureStore((state) => state.openedCapture);
  const projectInputs = useProjectStore((state) => state.projectInputs);
  const actionEvents = useEvidenceStore((state) => state.actionEvents);
  const { sessionId, turnId: inspectorTurnId, active: inspectorActive } = useRequestInspectorTarget();

  const progressSnapshot = useMemo(
    () => getSessionProgressSnapshot(currentRun, workflowState, reasoningSummaries, t),
    [currentRun, reasoningSummaries, t, workflowState],
  );
  const capabilitySummary = workflowState?.harnessTasks?.length ?? 0;
  const hasWorkingFolderActivity = Boolean(currentRun) || actionEvents.length > 0;

  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(() => ({
    sessionProgress: true,
    sessionWorkingFolder: true,
    sessionCapabilities: true,
    sessionContext: true,
    artifactTree: true,
    memory: false,
    requestInspector: false,
  }));
  const lastSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    const nextSessionId = currentSession?.sessionId ?? null;
    if (nextSessionId === lastSessionIdRef.current) {
      return;
    }

    lastSessionIdRef.current = nextSessionId;
    setExpandedSections({
      sessionProgress: true,
      sessionWorkingFolder: true,
      sessionCapabilities: true,
      sessionContext: true,
      artifactTree: true,
      memory: false,
      requestInspector: false,
    });
  }, [currentRun, currentSession?.sessionId]);

  const toggleSection = (sectionId: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));
  };

  const sessionFolderName = currentSession?.sessionPath.split(/[\\/]/).filter(Boolean).pop() || currentSession?.title || '--';
  const contextSummary = getSessionContextSummary(openedCapture?.filePath, projectInputs.length, t);

  return (
    <div className="control-panel">
      <div className="cp-content scrollbar-thin">
        <CollapsibleSection
          id="sessionProgress"
          title={t('control.sessionProgress')}
          icon={(
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          )}
          variant="session"
          isExpanded={expandedSections.sessionProgress}
          onToggle={() => toggleSection('sessionProgress')}
          summary={progressSnapshot.isIdle ? undefined : (
            <>
              <span className="cp-section-summary-main">{progressSnapshot.statusLabel}</span>
              <span className="cp-section-summary-badge">{progressSnapshot.progress}%</span>
            </>
          )}
        >
          <SessionProgressPanel />
        </CollapsibleSection>

        <CollapsibleSection
          id="artifactTree"
          title="Artifacts & Tools"
          icon={(
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
              <line x1="12" y1="22.08" x2="12" y2="12" />
            </svg>
          )}
          variant="session"
          isExpanded={expandedSections.artifactTree}
          onToggle={() => toggleSection('artifactTree')}
        >
          <ArtifactTree />
        </CollapsibleSection>

        <CollapsibleSection
          id="sessionWorkingFolder"
          title={t('control.sessionWorkingFolder')}
          icon={(
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
            </svg>
          )}
          variant="session"
          isExpanded={expandedSections.sessionWorkingFolder}
          onToggle={() => toggleSection('sessionWorkingFolder')}
          summary={hasWorkingFolderActivity ? <span className="cp-section-summary-main">{sessionFolderName}</span> : undefined}
        >
          <SessionWorkingFolderPanel />
        </CollapsibleSection>

        <CollapsibleSection
          id="sessionCapabilities"
          title={t('control.sessionCapabilities')}
          icon={(
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 7h7" />
              <path d="M14 12h7" />
              <path d="M14 17h7" />
              <path d="M4 7h6" />
              <path d="M4 12h6" />
              <path d="M4 17h6" />
              <path d="M7 4v6" />
              <path d="M17 9v6" />
            </svg>
          )}
          variant="session"
          isExpanded={expandedSections.sessionCapabilities}
          onToggle={() => toggleSection('sessionCapabilities')}
          summary={capabilitySummary > 0 ? (
            <span className="cp-section-summary-main">
              {t('control.sessionCapabilitiesSpecialistCount', { count: capabilitySummary })}
            </span>
          ) : undefined}
        >
          <div className="session-capabilities-stack">
            <SessionCapabilitiesPanel />
            <RdxRuntimeContextPanel />
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          id="sessionContext"
          title={t('control.sessionContext')}
          icon={(
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          )}
          variant="session"
          isExpanded={expandedSections.sessionContext}
          onToggle={() => toggleSection('sessionContext')}
          summary={<span className="cp-section-summary-main">{contextSummary}</span>}
        >
          <SessionContextPanel />
        </CollapsibleSection>

        <CollapsibleSection
          id="requestInspector"
          title={t('control.requestInspector')}
          icon={(
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="8" y1="13" x2="16" y2="13" />
              <line x1="8" y1="17" x2="13" y2="17" />
            </svg>
          )}
          variant="session"
          isExpanded={expandedSections.requestInspector}
          onToggle={() => toggleSection('requestInspector')}
        >
          {sessionId && inspectorTurnId ? (
            <RequestInspector
              sessionId={sessionId}
              turnId={inspectorTurnId}
              active={inspectorActive}
            />
          ) : (
            <div className="request-inspector is-loading" data-testid="request-inspector">
              {t('control.requestInspectorWaiting')}
            </div>
          )}
        </CollapsibleSection>

        <CollapsibleSection
          id="memory"
          title={t('memory.panelTitle')}
          icon={(
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="6" width="18" height="12" rx="2" />
              <line x1="7" y1="6" x2="7" y2="18" />
              <line x1="17" y1="6" x2="17" y2="18" />
            </svg>
          )}
          variant="session"
          isExpanded={expandedSections.memory}
          onToggle={() => toggleSection('memory')}
        >
          <MemoryPanel />
        </CollapsibleSection>
      </div>
    </div>
  );
};

export default ClassicSessionControlPanel;
