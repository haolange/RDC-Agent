import React from 'react';
import type { RdxRuntimeOverview } from '@shared/types/rdxRuntime';
import { formatTokenCount } from '@shared/utils/tokens';
import { useI18n } from '../../../../i18n';
import { useSessionStore } from '../../../../stores/sessionStore';
import { RequestInspector } from '../../../debugger/RequestDiagnostics/RequestInspector';
import { useRequestInspectorTarget } from '../../../debugger/RequestDiagnostics/useRequestInspectorTarget';

export const DeveloperDiagnosticsSettings: React.FC<{
  overview: RdxRuntimeOverview | null;
  loading: boolean;
  error: string;
}> = ({ overview, loading, error }) => {
  const { t } = useI18n();
  const target = useRequestInspectorTarget();
  const prepared = useSessionStore((state) => state.preparedTurnContext);
  const runtimeDiagnostics = overview?.diagnostics ?? [];
  const runtimeState = error ? 'error' : runtimeDiagnostics.length > 0 ? 'warning' : 'success';

  return (
    <section className="settings-page settings-page-diagnostics" data-testid="settings-developer-diagnostics">
      <div className="settings-diagnostics-summary-grid">
        <section className="settings-diagnostics-card">
          <div className="settings-diagnostics-card-head">
            <div>
              <div className="settings-section-title">{t('settings.diagnosticsRuntimeTitle')}</div>
              <div className="settings-section-subtitle">{t('settings.diagnosticsRuntimeHint')}</div>
            </div>
            <span className={'settings-diagnostics-state status-' + runtimeState}>
              {loading
                ? t('settings.diagnosticsLoading')
                : error
                  ? t('settings.diagnosticsUnavailable')
                  : runtimeDiagnostics.length > 0
                    ? t('settings.diagnosticsIssueCount', { count: runtimeDiagnostics.length })
                    : t('settings.diagnosticsReady')}
            </span>
          </div>
          {error ? <div className="settings-diagnostics-error" role="alert">{error}</div> : null}
          <dl className="settings-diagnostics-facts">
            <div>
              <dt>{t('settings.diagnosticsUserRoot')}</dt>
              <dd><code>{overview?.userRoot ?? '-'}</code></dd>
            </div>
            <div>
              <dt>{t('settings.diagnosticsProjectRoot')}</dt>
              <dd><code>{overview?.projectRoot ?? t('settings.diagnosticsNoProject')}</code></dd>
            </div>
          </dl>
          {runtimeDiagnostics.length > 0 ? (
            <ul className="settings-diagnostics-list">
              {runtimeDiagnostics.map((diagnostic, index) => <li key={diagnostic + index}>{diagnostic}</li>)}
            </ul>
          ) : !loading && !error ? (
            <div className="settings-diagnostics-empty">{t('settings.diagnosticsNoRuntimeIssues')}</div>
          ) : null}
        </section>

        <section className="settings-diagnostics-card" data-testid="diagnostics-context-contract">
          <div className="settings-diagnostics-card-head">
            <div>
              <div className="settings-section-title">{t('settings.diagnosticsContextTitle')}</div>
              <div className="settings-section-subtitle">{t('settings.diagnosticsContextHint')}</div>
            </div>
          </div>
          {prepared ? (
            <>
              <dl className="settings-diagnostics-facts">
                <div>
                  <dt>{t('settings.diagnosticsRoute')}</dt>
                  <dd><code>{prepared.route.providerId}/{prepared.route.effectiveModelId}</code></dd>
                </div>
                <div>
                  <dt>{t('settings.diagnosticsContinuation')}</dt>
                  <dd>
                    <code>{prepared.continuation.strategy}</code>
                    <span>{t('contextBreakdown.replayedArtifacts', { count: prepared.continuation.replayedArtifactCount })}</span>
                    <span>{t('contextBreakdown.droppedArtifacts', { count: prepared.continuation.droppedArtifactCount })}</span>
                  </dd>
                </div>
                <div>
                  <dt>{t('settings.diagnosticsDerivedContext')}</dt>
                  <dd>
                    <code>{prepared.derivedContext.status}</code>
                    <span>{t('contextBreakdown.compactedTurns', { count: prepared.derivedContext.compactedTurnCount })}</span>
                  </dd>
                </div>
                <div>
                  <dt>{t('settings.diagnosticsCache')}</dt>
                  <dd>
                    <code>{prepared.cache.enabled ? prepared.cache.mode : t('contextBreakdown.cacheDisabled')}</code>
                    <span>{t('contextBreakdown.cacheStablePrefix', {
                      segments: prepared.cache.stableSegmentCount,
                      tokens: formatTokenCount(prepared.cache.stableTokenEstimate),
                    })}</span>
                  </dd>
                </div>
                <div>
                  <dt>{t('settings.diagnosticsExecutionFingerprint')}</dt>
                  <dd><code>{prepared.continuation.executionFingerprint}</code></dd>
                </div>
              </dl>
              <div className="settings-diagnostics-note">{prepared.cache.reason}</div>
            </>
          ) : (
            <div className="settings-diagnostics-empty">{t('settings.diagnosticsNoPreparedContext')}</div>
          )}
        </section>
      </div>

      <section className="settings-diagnostics-card settings-diagnostics-request-card">
        <div className="settings-diagnostics-card-head">
          <div>
            <div className="settings-section-title">{t('control.requestInspector')}</div>
            <div className="settings-section-subtitle">{t('settings.diagnosticsRequestHint')}</div>
          </div>
          {target.turnId ? (
            <span className={'settings-diagnostics-state status-' + (target.active ? 'warning' : 'success')}>
              {target.active ? t('settings.diagnosticsRequestActive') : t('settings.diagnosticsRequestCaptured')}
            </span>
          ) : null}
        </div>
        {target.sessionId && target.turnId ? (
          <>
            <div className="settings-diagnostics-target">
              <span>{target.sessionTitle ?? target.sessionId}</span>
              <code>{target.turnId}</code>
            </div>
            <RequestInspector sessionId={target.sessionId} turnId={target.turnId} active={target.active} />
          </>
        ) : (
          <div className="settings-diagnostics-empty">
            {target.sessionId ? t('settings.diagnosticsNoTurn') : t('settings.diagnosticsNoSession')}
          </div>
        )}
      </section>
    </section>
  );
};
