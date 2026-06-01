import React from 'react';
import { ArtifactViewerLayout } from './ArtifactViewerLayout';
import { useArtifactViewer } from './useArtifactViewer';
import './ArtifactViewer.css';

export const ArtifactViewer: React.FC = () => {
  const viewer = useArtifactViewer();
  return <ArtifactViewerLayout {...viewer} />;
};

export default ArtifactViewer;
