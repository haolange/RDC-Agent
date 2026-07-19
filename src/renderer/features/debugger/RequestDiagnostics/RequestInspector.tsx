import React, { useEffect, useMemo, useState } from 'react';
import type { RequestEnvelopeSnapshot } from '@shared/types/rdxRuntime';
import { useI18n, type TranslationKey } from '../../../i18n';
import { getElectronApi } from '../../../platform/getElectronApi';
import { Button } from '../../../ui/Button';
import './RequestInspector.css';

type InspectorTab = 'overview' | 'instructions' | 'messages' | 'tools' | 'resources' | 'protocol' | 'tokens';

const TAB_KEYS: Array<{ id: InspectorTab; labelKey: TranslationKey }> = [
  { id: 'overview', labelKey: 'control.requestInspectorTabOverview' },
  { id: 'instructions', labelKey: 'control.requestInspectorTabInstructions' },
  { id: 'messages', labelKey: 'control.requestInspectorTabMessages' },
  { id: 'tools', labelKey: 'control.requestInspectorTabTools' },
  { id: 'resources', labelKey: 'control.requestInspectorTabResources' },
  { id: 'protocol', labelKey: 'control.requestInspectorTabProtocol' },
  { id: 'tokens', labelKey: 'control.requestInspectorTabTokens' },
];

export const RequestInspector: React.FC<{
  sessionId: string;
  turnId: string;
  active?: boolean;
}> = ({ sessionId, turnId, active }) => {
  const { t } = useI18n();
  const [snapshots, setSnapshots] = useState<RequestEnvelopeSnapshot[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [tab, setTab] = useState<InspectorTab>('overview');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const api = getElectronApi();
    setSnapshots([]);
    setSelectedId('');
    setError('');
    if (!api) {
      setError(t('control.requestInspectorUnavailable'));
      return () => { cancelled = true; };
    }
    const load = () => api.rdxRuntime.listRequestSnapshots(sessionId, turnId).then((items) => {
      if (cancelled) return;
      setError('');
      setSnapshots(items);
      setSelectedId((current) => items.some((item) => item.id === current)
        ? current
        : items[items.length - 1]?.id ?? '');
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
    });
    void load();
    const timer = active ? window.setInterval(() => void load(), 750) : undefined;
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [active, sessionId, t, turnId]);

  const selected = snapshots.find((item) => item.id === selectedId) ?? snapshots[snapshots.length - 1];
  const payload = useMemo(() => {
    if (!selected) return null;
    switch (tab) {
      case 'overview':
        return {
          id: selected.id,
          callIndex: selected.callIndex,
          route: selected.route,
          execution: selected.requestPlan.executionIdentity,
          state: selected.requestPlan.statePlan,
          transition: selected.requestPlan.contextTransitionPlan,
          reasoning: selected.reasoning,
          cache: selected.cache,
          redactions: selected.redactions,
          createdAt: selected.createdAt,
          completedAt: selected.completedAt,
        };
      case 'instructions':
        return { systemPrompt: selected.promptPlan.systemPrompt, segments: selected.promptPlan.segments };
      case 'messages':
        return selected.messages;
      case 'tools':
        return selected.tools;
      case 'resources':
        return selected.promptPlan.segments.map(({ id, kind, scope, sourcePath, sourceHash, precedence, stability, tokenEstimate }) => ({
          id, kind, scope, sourcePath, sourceHash, precedence, stability, tokenEstimate,
        }));
      case 'protocol':
        return {
          route: selected.requestPlan.route,
          statePlan: selected.requestPlan.statePlan,
          cachePlan: selected.requestPlan.cachePlan,
          toolLoopPlan: selected.requestPlan.toolLoopPlan,
          streamingPlan: selected.requestPlan.streamingPlan,
          contextTransitionPlan: selected.requestPlan.contextTransitionPlan,
          headers: selected.requestPlan.headers,
          bodyPatch: selected.requestPlan.bodyPatch,
          controls: selected.controls,
          reasoning: selected.reasoning,
          compiledCache: selected.cache,
        };
      case 'tokens':
        return {
          usage: selected.usage,
          promptEstimate: selected.promptPlan.totalTokenEstimate,
          metrics: selected.promptPlan.metrics,
          stablePrefix: selected.promptPlan.stablePrefix,
          cache: selected.cache,
        };
    }
  }, [selected, tab]);

  if (!snapshots.length && !error) {
    return (
      <div className="request-inspector is-loading" data-testid="request-inspector" role="status">
        {t('control.requestInspectorWaiting')}
      </div>
    );
  }

  return (
    <div className="request-inspector is-open" data-testid="request-inspector">
      <div className="request-inspector-head">
        <span className="request-inspector-title">{t('control.requestInspector')}</span>
        <span className="request-inspector-calls">
          {t('control.requestInspectorCalls', { count: snapshots.length })}
        </span>
      </div>
      <div className="request-inspector-body">
        {snapshots.length > 1 ? (
          <select
            className="request-inspector-call"
            value={selected?.id ?? ''}
            onChange={(event) => setSelectedId(event.target.value)}
            aria-label={t('control.requestInspectorCallLabel')}
          >
            {snapshots.map((snapshot) => (
              <option key={snapshot.id} value={snapshot.id}>
                {t('control.requestInspectorCallOption', {
                  index: snapshot.callIndex,
                  provider: snapshot.route.providerId,
                  model: snapshot.route.modelId,
                })}
              </option>
            ))}
          </select>
        ) : null}
        <div className="request-inspector-tabs" role="tablist">
          {TAB_KEYS.map((item) => (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={'request-inspector-tab' + (tab === item.id ? ' active' : '')}
              key={item.id}
              onClick={() => setTab(item.id)}
            >
              {t(item.labelKey)}
            </Button>
          ))}
        </div>
        {error ? (
          <div className="request-inspector-error" role="alert">{error}</div>
        ) : (
          <pre className="request-inspector-payload">{JSON.stringify(payload, null, 2)}</pre>
        )}
      </div>
    </div>
  );
};

export default RequestInspector;
