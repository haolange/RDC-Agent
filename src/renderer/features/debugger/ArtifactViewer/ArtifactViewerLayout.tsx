import React from 'react';
import { FILE_ICONS } from './artifactViewerIcons';
import { formatDate, formatFileSize, type ViewerArtifactRecord } from './artifactViewerModel';

interface ArtifactViewerLayoutProps {
  viewMode: 'grid' | 'list';
  setViewMode: (mode: 'grid' | 'list') => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  filteredArtifacts: ViewerArtifactRecord[];
  selectedArtifact: ViewerArtifactRecord | null;
  setSelectedArtifactId: (id: string | null) => void;
}

export const ArtifactViewerLayout: React.FC<ArtifactViewerLayoutProps> = ({
  viewMode,
  setViewMode,
  searchQuery,
  setSearchQuery,
  filteredArtifacts,
  selectedArtifact,
  setSelectedArtifactId,
}) => (
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
