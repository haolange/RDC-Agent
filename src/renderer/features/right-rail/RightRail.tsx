import React from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { ProjectCaptureImportPanel } from './ProjectCaptureImportPanel';
import { SessionRightRail } from './SessionRightRail';
import './RightRail.css';

export const RightRail: React.FC = () => {
  const currentProject = useProjectStore((state) => state.currentProject);
  const currentSessionId = useProjectStore((state) => state.currentSessionId);
  const rightRailTarget = useProjectStore((state) => state.rightRailTarget);

  if (!currentProject) return null;
  if (rightRailTarget !== 'session' || !currentSessionId) {
    return <ProjectCaptureImportPanel key={`${currentProject.projectId}:project`} />;
  }

  return <SessionRightRail key={`${currentProject.projectId}:${currentSessionId}`} />;
};
