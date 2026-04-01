import React, { useState, useEffect } from 'react';

interface Artifact {
  name: string;
  path: string;
  type: 'yaml' | 'json' | 'md' | 'image' | 'other';
  size: number;
  modified: string;
}

/**
 * ArtifactViewer - Artifact查看器
 * 显示workspace中的artifact文件列表和内容
 */
export const ArtifactViewer: React.FC = () => {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null);
  const [content, setContent] = useState<string>('');

  // 加载artifact列表
  useEffect(() => {
    // TODO: 实现从workspace加载artifact列表
    setArtifacts([
      { name: 'entry_gate.yaml', path: 'artifacts/entry_gate.yaml', type: 'yaml', size: 1024, modified: '2024-01-01' },
      { name: 'intake_gate.yaml', path: 'artifacts/intake_gate.yaml', type: 'yaml', size: 512, modified: '2024-01-01' },
      { name: 'runtime_topology.yaml', path: 'artifacts/runtime_topology.yaml', type: 'yaml', size: 2048, modified: '2024-01-01' },
      { name: 'hypothesis_board.yaml', path: 'notes/hypothesis_board.yaml', type: 'yaml', size: 1536, modified: '2024-01-01' },
    ]);
  }, []);

  // 加载artifact内容
  const loadContent = async (artifact: Artifact) => {
    setSelectedArtifact(artifact);
    // TODO: 实现从文件系统读取内容
    setContent(`# ${artifact.name}\n\nContent will be loaded from file system...`);
  };

  // 获取文件图标
  const getFileIcon = (type: Artifact['type']): React.ReactNode => {
    switch (type) {
      case 'yaml':
      case 'json':
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
        );
      case 'md':
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        );
      case 'image':
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        );
      default:
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
            <polyline points="13 2 13 9 20 9" />
          </svg>
        );
    }
  };

  return (
    <div className="artifact-viewer panel">
      <div className="panel-header">
        <span>Artifacts</span>
      </div>
      <div className="panel-content">
        <div className="artifact-list">
          {artifacts.map((artifact) => (
            <div
              key={artifact.path}
              className={`artifact-item ${selectedArtifact?.path === artifact.path ? 'selected' : ''}`}
              onClick={() => loadContent(artifact)}
            >
              <span className="artifact-icon">{getFileIcon(artifact.type)}</span>
              <span className="artifact-name">{artifact.name}</span>
            </div>
          ))}
        </div>

        {selectedArtifact && (
          <div className="artifact-preview">
            <div className="preview-header">
              <span>{selectedArtifact.name}</span>
              <span className="preview-size">{selectedArtifact.size} bytes</span>
            </div>
            <div className="preview-content">
              <pre>{content}</pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ArtifactViewer;
