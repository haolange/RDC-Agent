import React, { useState } from 'react';
import { TaskMonitor } from './TaskMonitor';
import { CaptureControl } from './CaptureControl';
import { ContextInfo } from './ContextInfo';
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
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    taskMonitor: true,
    captureControl: true,
    contextInfo: false,
  });

  const toggleSection = (sectionId: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));
  };

  return (
    <div className="control-panel">
      {/* Panel Header */}
      <div className="cp-header">
        <span className="cp-header-title">控制面板</span>
        <div className="cp-header-actions">
          <button
            className="cp-header-btn"
            onClick={() => {
              setExpandedSections({
                taskMonitor: true,
                captureControl: true,
                contextInfo: true,
              });
            }}
            title="Expand All"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 3 21 3 21 9" />
              <polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          </button>
          <button
            className="cp-header-btn"
            onClick={() => {
              setExpandedSections({
                taskMonitor: false,
                captureControl: false,
                contextInfo: false,
              });
            }}
            title="Collapse All"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="4 14 10 14 10 20" />
              <polyline points="20 10 14 10 14 4" />
              <line x1="14" y1="10" x2="21" y2="3" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          </button>
        </div>
      </div>

      {/* Panel Content */}
      <div className="cp-content scrollbar-thin">
        {/* Task Monitor Section */}
        <CollapsibleSection
          id="taskMonitor"
          title="任务监控"
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

        {/* Capture Control Section */}
        <CollapsibleSection
          id="captureControl"
          title="Capture 控制"
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

        {/* Context Info Section */}
        <CollapsibleSection
          id="contextInfo"
          title="Context 信息"
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
      </div>
    </div>
  );
};

export default ControlPanel;
