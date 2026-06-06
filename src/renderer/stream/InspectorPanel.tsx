import React from 'react';
import type { TimelineNode } from '@shared/types/agenticTrace';

interface InspectorPanelProps {
  node: TimelineNode | null;
  onClose: () => void;
}

export const InspectorPanel: React.FC<InspectorPanelProps> = ({ node, onClose }) => {
  const [tab, setTab] = React.useState<'summary' | 'raw'>('summary');

  if (!node) return null;
  return (
    <aside className="trace-inspector" data-testid="trace-inspector">
      <header>
        <strong>{node.title}</strong>
        <button type="button" onClick={onClose}>Close</button>
      </header>
      <div className="trace-tabs" role="tablist" aria-label="Trace inspector">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'summary'}
          className={tab === 'summary' ? 'active' : ''}
          onClick={() => setTab('summary')}
        >
          Summary
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'raw'}
          className={tab === 'raw' ? 'active' : ''}
          data-testid="trace-inspector-raw-tab"
          onClick={() => setTab('raw')}
        >
          Raw
        </button>
      </div>
      {tab === 'summary' ? (
        <dl className="trace-inspector-summary">
          <div><dt>Node</dt><dd>{node.nodeId}</dd></div>
          <div><dt>Status</dt><dd>{node.status}</dd></div>
          <div><dt>Renderer</dt><dd>{node.renderer}</dd></div>
        </dl>
      ) : (
        <pre className="trace-inspector-raw trace-inspector-code" data-testid="trace-inspector-raw">
          {JSON.stringify(node.payload, null, 2)}
        </pre>
      )}
    </aside>
  );
};
