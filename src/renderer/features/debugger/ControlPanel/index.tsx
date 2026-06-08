import React, { useState } from 'react';
import { useI18n } from '../../../i18n';
import { useCaptureStore } from '../../../stores/captureStore';
import { useProjectStore } from '../../../stores/projectStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useWorkflowStore } from '../../../stores/workflowStore';
import { CaptureLibrary } from './CaptureLibrary';
import { CollapsibleSection } from './CollapsibleSection';
import { ClassicSessionControlPanel } from './SessionControlPanel';
import { TraceRightPanel } from './TraceRightPanel';
import { shouldShowTraceRightRail } from './traceRail';
import './ControlPanel.css';

type RightRailMode = 'hidden' | 'project' | 'session';

const ProjectControlPanel: React.FC = () => {
  const { t } = useI18n();
  const projectInputs = useProjectStore((state) => state.projectInputs);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    captureLibrary: true,
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

  return <ProjectControlPanel />;
};

export default ControlPanel;


