import React, { useEffect, useMemo, useState } from 'react';
import type { RequestEnvelopeSnapshot } from '@shared/types/rdxRuntime';
import { getElectronApi } from '../../../platform/getElectronApi';

type InspectorTab = 'overview' | 'instructions' | 'messages' | 'tools' | 'resources' | 'protocol' | 'tokens';
const TABS: Array<{ id: InspectorTab; label: string }> = [
  { id: 'overview', label: 'Overview' }, { id: 'instructions', label: 'Instructions' },
  { id: 'messages', label: 'Messages' }, { id: 'tools', label: 'Tools' },
  { id: 'resources', label: 'Effective Resources' }, { id: 'protocol', label: 'Protocol Mapping' },
  { id: 'tokens', label: 'Tokens' },
];

export const RequestInspector: React.FC<{ sessionId: string; turnId: string; active?: boolean }> = ({ sessionId, turnId, active }) => {
  const [open, setOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<RequestEnvelopeSnapshot[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [tab, setTab] = useState<InspectorTab>('overview');
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    const api = getElectronApi();
    if (!api) { setError('Runtime bridge is unavailable.'); return () => { cancelled = true; }; }
    const load = () => api.rdxRuntime.listRequestSnapshots(sessionId, turnId).then((items) => {
      if (cancelled) return;
      setSnapshots(items); setSelectedId((current) => current || items[items.length - 1]?.id || '');
    }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); });
    void load();
    const timer = active ? window.setInterval(() => void load(), 750) : undefined;
    return () => { cancelled = true; if (timer) window.clearInterval(timer); };
  }, [active, sessionId, turnId]);
  const selected = snapshots.find((item) => item.id === selectedId) ?? snapshots[snapshots.length - 1];
  const payload = useMemo(() => {
    if (!selected) return null;
    switch (tab) {
      case 'overview': return { id: selected.id, callIndex: selected.callIndex, route: selected.route, reasoning: selected.reasoning, redactions: selected.redactions, createdAt: selected.createdAt, completedAt: selected.completedAt };
      case 'instructions': return { systemPrompt: selected.promptPlan.systemPrompt, segments: selected.promptPlan.segments };
      case 'messages': return selected.messages;
      case 'tools': return selected.tools;
      case 'resources': return selected.promptPlan.segments.map(({ id, kind, scope, sourcePath, sourceHash, precedence, tokenEstimate }) => ({ id, kind, scope, sourcePath, sourceHash, precedence, tokenEstimate }));
      case 'protocol': return { route: selected.route, controls: selected.controls, reasoning: selected.reasoning };
      case 'tokens': return { usage: selected.usage, promptEstimate: selected.promptPlan.totalTokenEstimate, metrics: selected.promptPlan.metrics };
    }
  }, [selected, tab]);
  if (!snapshots.length && !error) return active ? <div className="request-inspector is-loading">Request Inspector · waiting for provider request…</div> : null;
  return <div className={`request-inspector ${open ? 'is-open' : ''}`} data-testid="request-inspector">
    <button type="button" className="request-inspector-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <span>Request Inspector</span><span>{snapshots.length} call{snapshots.length === 1 ? '' : 's'}</span>
    </button>
    {open && <div className="request-inspector-body">
      {snapshots.length > 1 && <select className="request-inspector-call" value={selected?.id} onChange={(event) => setSelectedId(event.target.value)} aria-label="LLM call">
        {snapshots.map((snapshot) => <option key={snapshot.id} value={snapshot.id}>Call {snapshot.callIndex} · {snapshot.route.providerId}/{snapshot.route.modelId}</option>)}
      </select>}
      <div className="request-inspector-tabs" role="tablist">{TABS.map((item) => <button type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'active' : ''} key={item.id} onClick={() => setTab(item.id)}>{item.label}</button>)}</div>
      {error ? <div className="request-inspector-error">{error}</div> : <pre className="request-inspector-payload">{JSON.stringify(payload, null, 2)}</pre>}
    </div>}
  </div>;
};
