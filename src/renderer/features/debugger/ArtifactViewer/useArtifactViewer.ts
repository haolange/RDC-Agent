import { useEffect, useMemo, useState } from 'react';
import type { ActionEvent } from '@shared/types/evidence';
import {
  type ViewerArtifactRecord,
  getArtifactName,
  getArtifactPath,
  inferFileType,
} from './artifactViewerModel';

export function useArtifactViewer() {
  const [artifactEvents, setArtifactEvents] = useState<ActionEvent[]>([]);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [searchQuery, setSearchQuery] = useState('');

  const electronAPI =
    typeof window !== 'undefined'
      ? (window as Window & { electronAPI?: Window['electronAPI'] }).electronAPI
      : undefined;

  useEffect(() => {
    const loadArtifacts = async () => {
      if (!electronAPI?.evidence?.getChain) return;

      try {
        const evidenceChain = await electronAPI.evidence.getChain();
        setArtifactEvents(evidenceChain.events.filter((event) => event.event_type === 'artifact_write'));
      } catch (error) {
        console.warn('Failed to load artifact events:', error);
      }
    };

    void loadArtifacts();
  }, [electronAPI]);

  useEffect(() => {
    if (!electronAPI) return;

    const handleEvidenceAdded = (payload: unknown) => {
      const nextEvent = payload as ActionEvent;
      if (nextEvent.event_type === 'artifact_write') {
        setArtifactEvents((current) => [...current, nextEvent]);
      }
    };

    electronAPI.on('evidence:eventAdded', handleEvidenceAdded);

    return () => {
      electronAPI.off('evidence:eventAdded', handleEvidenceAdded);
    };
  }, [electronAPI]);

  const artifacts = useMemo<ViewerArtifactRecord[]>(() => {
    const byPath = new Map<string, ViewerArtifactRecord>();

    artifactEvents.forEach((event) => {
      const path = getArtifactPath(event);
      const nextArtifact: ViewerArtifactRecord = {
        id: event.event_id,
        name: getArtifactName(path),
        path,
        type: inferFileType(path),
        size: typeof event.payload.size_bytes === 'number' ? event.payload.size_bytes : undefined,
        modified: event.ts_ms,
        payload: event.payload,
      };

      const currentArtifact = byPath.get(path);
      if (!currentArtifact || currentArtifact.modified < nextArtifact.modified) {
        byPath.set(path, nextArtifact);
      }
    });

    return Array.from(byPath.values()).sort((left, right) => right.modified - left.modified);
  }, [artifactEvents]);

  const filteredArtifacts = useMemo(
    () => artifacts.filter((artifact) => artifact.name.toLowerCase().includes(searchQuery.toLowerCase())),
    [artifacts, searchQuery],
  );

  const selectedArtifact = useMemo(
    () => filteredArtifacts.find((artifact) => artifact.id === selectedArtifactId)
      ?? artifacts.find((artifact) => artifact.id === selectedArtifactId)
      ?? null,
    [artifacts, filteredArtifacts, selectedArtifactId],
  );

  return {
    viewMode,
    setViewMode,
    searchQuery,
    setSearchQuery,
    selectedArtifactId,
    setSelectedArtifactId,
    filteredArtifacts,
    selectedArtifact,
  };
}
