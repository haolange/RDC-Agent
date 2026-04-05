import React, { useState } from 'react';
import { TaskMonitor } from './TaskMonitor';
import { CaptureLibrary } from './CaptureLibrary';
import { OpenedCapture } from './OpenedCapture';
import { RuntimeContext } from './RuntimeContext';
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
  id,
  title,
  icon,
  isExpanded,
  onToggle,
  children,
  badge,
}) => {
  return (
    <div
      className={`cp-section ${isExpanded ? 'expanded' : ''}`}
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
        <span className={`cp-section-arrow ${isExpanded ? 'expanded' : ''}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>
      {isExpanded ? (
        <div className="cp-section-content">
          <div className="cp-section-inner">{children}</div>
        </div>
      ) : null}
    </div>
  );
};

export const ControlPanel: React.FC = () => {
  const { t } = useI18n();
  const projectInputs = useSessionStore((state) => state.projectInputs);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    taskMonitor: true,
    captureLibrary: true,
    openedCapture: true,
    runtimeContext: false,
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
          id="captureLibrary"
          title={t('control.captureLibrary')}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
            </svg>
          }
          isExpanded={expandedSections.captureLibrary}
          onToggle={() => toggleSection('captureLibrary')}
          badge={projectInputs.length}
        >
          <CaptureLibrary />
        </CollapsibleSection>

        <CollapsibleSection
          id="openedCapture"
          title={t('control.openedCapture')}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          }
          isExpanded={expandedSections.openedCapture}
          onToggle={() => toggleSection('openedCapture')}
        >
          <OpenedCapture />
        </CollapsibleSection>

        <CollapsibleSection
          id="runtimeContext"
          title={t('control.runtimeContext')}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          }
          isExpanded={expandedSections.runtimeContext}
          onToggle={() => toggleSection('runtimeContext')}
        >
          <RuntimeContext />
        </CollapsibleSection>
      </div>
    </div>
  );
};

export default ControlPanel;
