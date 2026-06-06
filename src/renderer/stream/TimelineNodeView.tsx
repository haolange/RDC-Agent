import React from 'react';
import type { TimelineNode } from '@shared/types/agenticTrace';
import { resolveRenderer } from './renderer-registry';

interface TimelineNodeViewProps {
  node: TimelineNode;
  depth?: number;
  onSelect?: (nodeId: string) => void;
}

export const TimelineNodeView: React.FC<TimelineNodeViewProps> = ({ node, depth = 0, onSelect }) => {
  const Renderer = resolveRenderer(node.renderer);
  return (
    <div className="trace-timeline-node" style={{ marginLeft: `${depth * 12}px` }}>
      <Renderer node={node} depth={depth} onSelect={onSelect} />
      {node.renderer !== 'phase_group' && node.children?.map((child) => (
        <TimelineNodeView key={child.nodeId} node={child} depth={depth + 1} onSelect={onSelect} />
      ))}
    </div>
  );
};
