import React, { useState } from 'react';
import { TaskMonitor } from './TaskMonitor';
import { CaptureControl } from './CaptureControl';
import { ContextInfo } from './ContextInfo';
import { ProjectInputs } from './ProjectInputs';
import { useI18n } from '../../i18n';
import { useSessionStore } from '../../stores/sessionStore';
import './ControlPanel.css';

interface CollapsibleSectionProps {
  id: string;
  title: string;
  icon: React.ReactNode;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  badge?: string | number;
}

const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  icon,
  isExpanded,
  onToggle,
  children,
  badge,
}) => {
  return (
    <div className={`cp-section ${isExpanded ? 'expanded' : ''}`}>
      <button className="cp-section-header" onClick={onToggle}>
        <div className="cp-section-title">
          <span className="cp-section-icon">{icon}</span>
          <span className="cp-section-label">{title}</span>
          {badge !== undefined && badge !== 0 && (
            <span className="cp-section-badge">{badge}</span>
          )}
        </div>
        <span className={`cp-section-arrow ${isExpanded ? 'expanded' : ''}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>
      <div className="cp-section-content">
        <div className="cp-section-inner">{children}</div>
      </div>
    </div>
  );
};

export const ControlPanel: React.FC = () => {
  const { t } = useI18n();
  const projectInputs = useSessionStore((state) => state.projectInputs);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    taskMonitor: true,
    captureControl: true,
    contextInfo: false,
    projectInputs: true,
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
          id="taskMonitor"
          title={t('control.taskMonitor')}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          }
          isExpanded={expandedSections.taskMonitor}
          onToggle={() => toggleSection('taskMonitor')}
        >
          <TaskMonitor />
        </CollapsibleSection>

        <CollapsibleSection
          id="captureControl"
          title={t('control.captureControl')}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          }
          isExpanded={expandedSections.captureControl}
          onToggle={() => toggleSection('captureControl')}
        >
          <CaptureControl />
        </CollapsibleSection>

        <CollapsibleSection
          id="contextInfo"
          title={t('control.contextInfo')}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          }
          isExpanded={expandedSections.contextInfo}
          onToggle={() => toggleSection('contextInfo')}
        >
          <ContextInfo />
        </CollapsibleSection>

        <CollapsibleSection
          id="projectInputs"
          title={t('control.projectInputs')}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
          }
          isExpanded={expandedSections.projectInputs}
          onToggle={() => toggleSection('projectInputs')}
          badge={projectInputs.length}
        >
          <ProjectInputs />
        </CollapsibleSection>
      </div>
    </div>
  );
};

export default ControlPanel;
