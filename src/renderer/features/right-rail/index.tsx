import React from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { ProjectCaptureImportPanel } from './ProjectCaptureImportPanel';
import { TraceRightPanel } from './TraceRightPanel';
import './RightRail.css';

export const ControlPanel: React.FC = () => {
  const currentProject = useProjectStore((state) => state.currentProject);
  const currentSession = useProjectStore((state) => state.currentSession);
  const rightRailTarget = useProjectStore((state) => state.rightRailTarget);

  if (!currentProject) return null;
  if (rightRailTarget !== 'session' || !currentSession) {
    return <ProjectCaptureImportPanel key={`${currentProject.projectId}:project`} />;
  }

  return <TraceRightPanel key={`${currentProject.projectId}:${currentSession.sessionId}`} />;
};

export default ControlPanel;
