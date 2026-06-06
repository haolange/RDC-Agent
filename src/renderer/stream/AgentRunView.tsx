import React, { useEffect, useMemo, useState } from 'react';
import type { AgentRunPresentation, TimelineNode } from '@shared/types/agenticTrace';
import { RunHeader } from './RunHeader';
import { TimelinePanel } from './TimelinePanel';
import { InspectorPanel } from './InspectorPanel';
import './stream.css';

interface AgentRunViewProps {
  presentation: AgentRunPresentation | null;
  emptyState: React.ReactNode;
}

const findNode = (nodes: TimelineNode[], nodeId: string): TimelineNode | null => {
  for (const node of nodes) {
    if (node.nodeId === nodeId) return node;
    if (node.children) {
      const found = findNode(node.children, nodeId);
      if (found) return found;
    }
  }
  return null;
};

export const AgentRunView: React.FC<AgentRunViewProps> = ({ presentation, emptyState }) => {
  const [inspectorNodeId, setInspectorNodeId] = useState<string | null>(null);
  const [inspectorClosed, setInspectorClosed] = useState(false);
  const runs = useMemo(() => presentation?.runs ?? [], [presentation?.runs]);
  const firstNodeId = runs[0]?.timeline.nodes[0]?.nodeId ?? null;

  useEffect(() => {
    setInspectorNodeId(null);
    setInspectorClosed(false);
  }, [presentation?.sessionId, presentation?.updatedAt]);

  if (!presentation || runs.length === 0) {
    return <>{emptyState}</>;
  }

  const activeInspectorNodeId = inspectorNodeId ?? (inspectorClosed ? null : firstNodeId);
  const inspectorNode = activeInspectorNodeId
    ? runs.flatMap((entry) => findNode(entry.timeline.nodes, activeInspectorNodeId) ? [findNode(entry.timeline.nodes, activeInspectorNodeId)!] : []).find(Boolean) ?? null
    : null;
  const handleSelectNode = (nodeId: string): void => {
    setInspectorNodeId(nodeId);
    setInspectorClosed(false);
  };

  return (
    <div className="agent-run-view" data-testid="agent-run-view">
      {runs.map((entry) => (
        <section key={entry.run.runId} className="trace-run-container" data-testid="trace-run-container">
          <RunHeader run={entry.run} />
          <TimelinePanel timeline={entry.timeline} onSelectNode={handleSelectNode} />
        </section>
      ))}
      <InspectorPanel node={inspectorNode} onClose={() => {
        setInspectorNodeId(null);
        setInspectorClosed(true);
      }} />
    </div>
  );
};

export default AgentRunView;
