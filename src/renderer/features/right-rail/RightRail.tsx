import React from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { ProjectCaptureImportPanel } from './ProjectCaptureImportPanel';
import { SessionRightRail } from './SessionRightRail';
import './RightRail.css';

export const RightRail: React.FC = () => {
  const currentProject = useProjectStore((state) => state.currentProject);
  const currentSession = useProjectStore((state) => state.currentSession);
  const rightRailTarget = useProjectStore((state) => state.rightRailTarget);

  if (!currentProject) return null;
  if (rightRailTarget !== 'session' || !currentSession) {
    return <ProjectCaptureImportPanel key={`${currentProject.projectId}:project`} />;
  }

  return <SessionRightRail key={`${currentProject.projectId}:${currentSession.sessionId}`} />;
};
