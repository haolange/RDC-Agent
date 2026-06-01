import React from 'react';
import type { AgentNode, AgentNodeStatus, ArtifactPayload } from '@shared/types/agentTimeline';
import {
  formatSize,
  getPayload,
  parseDocumentBlocks,
  statusLabel,
} from '../services/timelineFormatters';

export const StatusBadge: React.FC<{ status: AgentNodeStatus }> = ({ status }) => (
  <span className={`amt-status amt-status-${status}`}>
    <span className="amt-status-dot" aria-hidden="true" />
    {statusLabel[status]}
  </span>
);

export const ExpandButton: React.FC<{
  expanded: boolean;
  onClick: () => void;
  label: string;
}> = ({ expanded, onClick, label }) => (
  <button
    type="button"
    className="amt-icon-button amt-expand-button"
    aria-label={label}
    aria-expanded={expanded}
    onClick={onClick}
  >
    <span aria-hidden="true">{expanded ? '⌃' : '⌄'}</span>
  </button>
);

export const EvidenceBadge: React.FC<{
  evidenceRefs: string[];
  onJump: (id: string) => void;
}> = ({ evidenceRefs, onJump }) => {
  if (evidenceRefs.length === 0) {
    return null;
  }

  return (
    <button
      type="button"
      className="amt-evidence-badge"
      data-testid="agent-timeline-evidence-badge"
      onClick={() => onJump(evidenceRefs[0])}
    >
      Evidence ×{evidenceRefs.length}
    </button>
  );
};

export const ArtifactGrid: React.FC<{ artifacts: AgentNode[] }> = ({ artifacts }) => {
  if (artifacts.length === 0) {
    return null;
  }

  return (
    <div className="amt-artifact-grid" data-testid="agent-timeline-artifact-grid">
      {artifacts.map((artifact) => {
        const payload = getPayload<ArtifactPayload>(artifact);
        const title = payload?.name ?? artifact.title;
        const size = formatSize(payload?.sizeBytes);
        return (
          <button
            key={artifact.id}
            type="button"
            className="amt-artifact-card"
            data-node-id={artifact.id}
            onClick={() => {
              if (payload?.path) {
                void window.electronAPI?.appShell.openPath(payload.path);
              }
            }}
          >
            <span className="amt-artifact-icon" aria-hidden="true">
              {payload?.artifactType === 'image' || payload?.artifactType === 'screenshot' ? '▧' : '{}'}
            </span>
            <span className="amt-artifact-copy">
              <span className="amt-artifact-name">{title}</span>
              {size ? <span className="amt-artifact-size">{size}</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
};

export const DocumentContent: React.FC<{ content: string; testId?: string }> = ({ content, testId }) => {
  const blocks = parseDocumentBlocks(content);
  return (
    <div className="amt-message-document" data-testid={testId}>
      {blocks.map((block, index) => {
        if (block.type === 'code') {
          return (
            <pre key={`code-${index}`} className="amt-message-code" data-testid="assistant-code-block">
              {block.language ? <span className="amt-message-code-language">{block.language}</span> : null}
              <code>{block.text}</code>
            </pre>
          );
        }
        if (block.type === 'list') {
          const ListTag = block.ordered ? 'ol' : 'ul';
          return (
            <ListTag key={`list-${index}`} className="amt-message-list">
              {block.items.map((item) => <li key={item}>{item}</li>)}
            </ListTag>
          );
        }
        return <p key={`paragraph-${index}`} className="amt-message-paragraph">{block.text}</p>;
      })}
    </div>
  );
};
