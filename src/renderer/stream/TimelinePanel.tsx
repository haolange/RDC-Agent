import React from 'react';
import type { TimelineProjection } from '@shared/types/agenticTrace';
import { TimelineNodeView } from './TimelineNodeView';

interface TimelinePanelProps {
  timeline: TimelineProjection;
  onSelectNode?: (nodeId: string) => void;
}

export const TimelinePanel: React.FC<TimelinePanelProps> = ({ timeline, onSelectNode }) => (
  <section className="trace-timeline-panel" data-testid="trace-timeline">
    {timeline.nodes.map((node) => (
      <TimelineNodeView key={node.nodeId} node={node} onSelect={onSelectNode} />
    ))}
  </section>
);
