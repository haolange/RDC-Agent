import React, { useState } from 'react';
import { useI18n } from '../../../i18n';
import { useCaptureStore } from '../../../stores/captureStore';
import { useProjectStore } from '../../../stores/projectStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useWorkflowStore } from '../../../stores/workflowStore';
import { CaptureLibrary } from './CaptureLibrary';
import { CollapsibleSection } from './CollapsibleSection';
import { ClassicSessionControlPanel } from './SessionControlPanel';
import { SourceControlPanel } from './SourceControlPanel';
import { TraceRightPanel } from './TraceRightPanel';
import { shouldShowTraceRightRail } from './traceRail';
import { Button } from '../../../ui/Button';
import './ControlPanel.css';

type RightRailMode = 'hidden' | 'project' | 'session' | 'source-control';

const ProjectControlPanel: React.FC = () => {
  const { t } = useI18n();
  const projectInputs = useProjectStore((state) => state.projectInputs);
  const setRightRailTarget = useProjectStore((state) => state.setRightRailTarget);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    captureLibrary: true,
    sourceControl: false,
  });

  const toggleSection = (sectionId: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));
  };

  return (
    <div className="control-panel">
      <div className="cp-content scrollbar-thin">
        <CollapsibleSection
          id="captureLibrary"
          title={t('control.captureLibrary')}
          icon={(
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
            </svg>
          )}
          isExpanded={expandedSections.captureLibrary}
          onToggle={() => toggleSection('captureLibrary')}
          badge={projectInputs.length}
        >
          <CaptureLibrary />
        </CollapsibleSection>
        <CollapsibleSection
          id="sourceControl"
          title={t('control.sourceControl')}
          icon={(
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="6" cy="6" r="3" />
              <circle cx="18" cy="18" r="3" />
              <path d="M8.5 8.5 15.5 15.5" />
              <path d="M6 9v7a2 2 0 0 0 2 2h7" />
            </svg>
          )}
          isExpanded={expandedSections.sourceControl}
          onToggle={() => toggleSection('sourceControl')}
        >
          <div className="source-control-entry">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setRightRailTarget('source-control')}
            >
              {t('control.sourceControlOpen')}
            </Button>
          </div>
        </CollapsibleSection>
      </div>
    </div>
  );
};

const SessionControlPanel: React.FC = () => {
  const presentation = useWorkflowStore((state) => state.tracePresentation);
  if (shouldShowTraceRightRail(presentation)) {
    return <TraceRightPanel />;
  }
  return <ClassicSessionControlPanel />;
};

export const ControlPanel: React.FC = () => {
  const currentProject = useProjectStore((state) => state.currentProject);
  const currentSession = useProjectStore((state) => state.currentSession);
  const rightRailTarget = useProjectStore((state) => state.rightRailTarget);
  const currentRun = useSessionStore((state) => state.currentRun);
  const openedCapture = useCaptureStore((state) => state.openedCapture);

  const rightRailMode: RightRailMode = !currentProject
    ? 'hidden'
    : rightRailTarget === 'source-control'
      ? 'source-control'
      : rightRailTarget === 'session' && currentSession
      ? 'session'
      : 'project';

  if (rightRailMode === 'hidden') {
    return null;
  }

  if (rightRailMode === 'session') {
    const sessionRailKey = [
      currentSession?.sessionId ?? 'no-session',
      currentRun?.runId ?? 'no-run',
      openedCapture?.inputId ?? 'no-capture',
    ].join(':');
    return <SessionControlPanel key={sessionRailKey} />;
  }

  if (rightRailMode === 'source-control') {
    return <SourceControlPanel />;
  }

  return <ProjectControlPanel />;
};

export default ControlPanel;

