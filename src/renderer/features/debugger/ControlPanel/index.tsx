import React, { useState } from 'react';
import { useI18n } from '../../../i18n';
import { useSessionStore } from '../../../stores/sessionStore';
import { CaptureLibrary } from './CaptureLibrary';
import { WorkstreamRightPanel } from './WorkstreamRightPanel';
import './ControlPanel.css';

type RightRailMode = 'hidden' | 'project' | 'session';

interface CollapsibleSectionProps {
  id: string;
  title: string;
  icon: React.ReactNode;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  badge?: string | number;
  summary?: React.ReactNode;
  variant?: 'project' | 'session';
}

const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  id,
  title,
  icon,
  isExpanded,
  onToggle,
  children,
  badge,
  summary,
  variant = 'project',
}) => {
  const sessionVariant = variant === 'session';

  return (
    <div
      className={`cp-section ${isExpanded ? 'expanded' : ''} ${sessionVariant ? 'cp-section-session' : ''}`}
      data-testid={`cp-section-${id}`}
    >
      <button className="cp-section-header" onClick={onToggle} aria-expanded={isExpanded}>
        <div className="cp-section-title">
          <span className="cp-section-icon">{icon}</span>
          <span className="cp-section-label">{title}</span>
          {badge !== undefined && badge !== 0 && (
            <span className="cp-section-badge">{badge}</span>
          )}
        </div>
        <div className="cp-section-trailing">
          {summary ? <div className="cp-section-summary">{summary}</div> : null}
          <span className={`cp-section-arrow ${isExpanded ? 'expanded' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
        </div>
      </button>
      {isExpanded ? (
        <div className="cp-section-content">
          <div className="cp-section-inner">{children}</div>
        </div>
      ) : null}
    </div>
  );
};

const ProjectControlPanel: React.FC = () => {
  const { t } = useI18n();
  const projectInputs = useSessionStore((state) => state.projectInputs);
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
  return <WorkstreamRightPanel />;
};

export const ControlPanel: React.FC = () => {
  const currentProject = useSessionStore((state) => state.currentProject);
  const currentSession = useSessionStore((state) => state.currentSession);
  const rightRailTarget = useSessionStore((state) => state.rightRailTarget);
  const currentRun = useSessionStore((state) => state.currentRun);
  const openedCapture = useSessionStore((state) => state.openedCapture);

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
