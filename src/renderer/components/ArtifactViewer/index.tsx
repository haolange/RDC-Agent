import React, { useEffect, useMemo, useState } from 'react';
import type { ActionEvent } from '@shared/types/evidence';
import './ArtifactViewer.css';

type FileType = 'yaml' | 'json' | 'md' | 'image' | 'other';

interface ArtifactRecord {
  id: string;
  name: string;
  path: string;
  type: FileType;
  size?: number;
  modified: number;
  payload: Record<string, unknown>;
}

const inferFileType = (path: string): FileType => {
  const extension = path.split('.').pop()?.toLowerCase();
  if (!extension) return 'other';
  if (extension === 'yaml' || extension === 'yml') return 'yaml';
  if (extension === 'json' || extension === 'jsonl') return 'json';
  if (extension === 'md') return 'md';
  if (['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(extension)) return 'image';
  return 'other';
};

const getArtifactPath = (event: ActionEvent): string => {
  return String(
    event.payload.path ||
      event.payload.artifact_path ||
      event.payload.output_path ||
      event.payload.url ||
      event.payload.artifact_name ||
      'unknown-artifact'
  );
};

const getArtifactName = (path: string): string => {
  const name = path.split(/[/\\]/).pop();
  return name || path;
};

const FILE_ICONS: Record<FileType, React.ReactNode> = {
  yaml: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <path d="M8 12h8" />
      <path d="M8 16h6" />
    </svg>
  ),
  json: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <path d="M8 12h.01" />
      <path d="M12 12h.01" />
      <path d="M16 12h.01" />
    </svg>
  ),
  md: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <path d="M9 12h6" />
      <path d="M9 16h6" />
    </svg>
  ),
  image: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  ),
  other: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  ),
};

export const ArtifactViewer: React.FC = () => {
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

    loadArtifacts();
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

  const artifacts = useMemo<ArtifactRecord[]>(() => {
    const byPath = new Map<string, ArtifactRecord>();

    artifactEvents.forEach((event) => {
      const path = getArtifactPath(event);
      const nextArtifact: ArtifactRecord = {
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

  const filteredArtifacts = useMemo(() => {
    return artifacts.filter((artifact) => artifact.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [artifacts, searchQuery]);

  const selectedArtifact = useMemo(
    () => filteredArtifacts.find((artifact) => artifact.id === selectedArtifactId) ?? artifacts.find((artifact) => artifact.id === selectedArtifactId) ?? null,
    [artifacts, filteredArtifacts, selectedArtifactId]
  );

  const formatFileSize = (size?: number): string => {
    if (!size) return '--';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (timestamp: number): string => {
    return new Date(timestamp).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="artifact-viewer">
      <div className="artifact-viewer-header">
        <div className="artifact-viewer-title">
          <svg className="artifact-viewer-title-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          <span>Artifacts</span>
        </div>

        <div className="artifact-viewer-actions">
          <div className="view-mode-toggle">
            <button className={`view-mode-btn ${viewMode === 'grid' ? 'active' : ''}`} onClick={() => setViewMode('grid')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
              </svg>
            </button>
            <button className={`view-mode-btn ${viewMode === 'list' ? 'active' : ''}`} onClick={() => setViewMode('list')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" />
                <line x1="3" y1="12" x2="3.01" y2="12" />
                <line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div className="artifact-toolbar">
        <div className="artifact-breadcrumb">
          <span className="breadcrumb-item">workspace</span>
          <span className="breadcrumb-item">current_case</span>
          <span className="breadcrumb-item">artifacts</span>
        </div>

        <div className="artifact-search">
          <svg className="artifact-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search artifacts..."
          />
        </div>
      </div>

      <div className="artifact-viewer-content">
        {selectedArtifact ? (
          <div className="file-preview">
            <div className="file-preview-header">
              <div className="file-preview-info">
                <span className="file-preview-name">{selectedArtifact.name}</span>
                <span className="file-preview-meta">
                  <span>{formatFileSize(selectedArtifact.size)}</span>
                  <span>•</span>
                  <span>{formatDate(selectedArtifact.modified)}</span>
                </span>
              </div>

              <button className="icon-button" onClick={() => setSelectedArtifactId(null)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="file-preview-content">
              <div className="artifact-preview-meta">
                <div className="artifact-preview-row">
                  <span className="artifact-preview-label">Path</span>
                  <span className="artifact-preview-value">{selectedArtifact.path}</span>
                </div>
                <div className="artifact-preview-row">
                  <span className="artifact-preview-label">Type</span>
                  <span className="artifact-preview-value">{selectedArtifact.type}</span>
                </div>
                <div className="artifact-preview-row">
                  <span className="artifact-preview-label">Preview</span>
                  <span className="artifact-preview-value">File system preview is not exposed yet. Showing evidence payload.</span>
                </div>
              </div>

              <div className="code-preview">
                <pre>{JSON.stringify(selectedArtifact.payload, null, 2)}</pre>
              </div>
            </div>
          </div>
        ) : (
          <div className="file-list">
            {filteredArtifacts.length === 0 ? (
              <div className="artifact-empty-state">
                <svg className="artifact-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                <div className="artifact-empty-title">No artifacts available</div>
                <div className="artifact-empty-description">
                  Artifact cards will appear here once the workflow writes outputs into the evidence chain.
                </div>
              </div>
            ) : viewMode === 'grid' ? (
              <div className="file-list-grid">
                {filteredArtifacts.map((artifact) => (
                  <div key={artifact.id} className="file-card" onClick={() => setSelectedArtifactId(artifact.id)}>
                    <div className={`file-card-icon ${artifact.type}`}>{FILE_ICONS[artifact.type]}</div>
                    <span className="file-card-name">{artifact.name}</span>
                    <span className="file-card-meta">{formatFileSize(artifact.size)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <table className="file-list-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Size</th>
                    <th>Modified</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredArtifacts.map((artifact) => (
                    <tr key={artifact.id} className="file-list-row" onClick={() => setSelectedArtifactId(artifact.id)}>
                      <td>
                        <div className="file-list-cell-name">
                          <span className={`file-list-cell-icon file-${artifact.type}`}>{FILE_ICONS[artifact.type]}</span>
                          {artifact.name}
                        </div>
                      </td>
                      <td>{formatFileSize(artifact.size)}</td>
                      <td>{formatDate(artifact.modified)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ArtifactViewer;
