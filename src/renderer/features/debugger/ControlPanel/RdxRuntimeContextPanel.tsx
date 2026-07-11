import React, { useCallback, useEffect, useState } from 'react';
import type { RdxRuntimeContext } from '@shared/types/session';
import { useI18n } from '../../../i18n';
import { getElectronApi } from '../../../platform/getElectronApi';

const formatUpdatedAt = (value: number | undefined): string => {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString();
};

export const RdxRuntimeContextPanel: React.FC = () => {
  const { t } = useI18n();
  const [runtimeContext, setRuntimeContext] = useState<RdxRuntimeContext | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const api = getElectronApi();
    if (!api?.context?.get) {
      setRuntimeContext(null);
      setError(t('control.rdxRuntimeUnavailable'));
      return;
    }

    try {
      const snapshot = await api.context.get();
      setRuntimeContext(snapshot?.runtimeContext ?? null);
      setError(null);
    } catch (failure) {
      setRuntimeContext(null);
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, [t]);

  useEffect(() => {
    void load();
    const api = getElectronApi();
    if (!api?.events?.onContextChanged) {
      return undefined;
    }
    return api.events.onContextChanged((snapshot) => {
      setRuntimeContext(snapshot?.runtimeContext ?? null);
      setError(null);
    });
  }, [load]);

  return (
    <div className="rdx-runtime-context-panel" data-testid="control-rdx-runtime-context">
      <span className="session-capability-label">{t('control.rdxRuntimeTitle')}</span>

      {error ? (
        <div className="panel-empty" role="alert">{error}</div>
      ) : !runtimeContext ? (
        <div className="panel-empty" role="status">
          {t('control.rdxRuntimeEmpty')}
        </div>
      ) : (
        <div className="rdx-runtime-context-facts">
          <div className="session-context-fact">
            <span className="session-context-label">{t('control.rdxRuntimeContextId')}</span>
            <span className="session-context-value mono" title={runtimeContext.contextId}>
              {runtimeContext.contextId || '--'}
            </span>
          </div>
          <div className="session-context-fact">
            <span className="session-context-label">{t('control.rdxRuntimeBackend')}</span>
            <span className="session-context-value">
              <span className={`context-badge ${runtimeContext.backend}`}>
                {runtimeContext.backend}
              </span>
            </span>
          </div>
          <div className="session-context-fact">
            <span className="session-context-label">{t('control.rdxRuntimeDevice')}</span>
            <span className="session-context-value" title={runtimeContext.deviceLabel ?? undefined}>
              {runtimeContext.deviceLabel || '--'}
            </span>
          </div>
          <div className="session-context-fact">
            <span className="session-context-label">{t('control.rdxRuntimeRemoteStatus')}</span>
            <span className="session-context-value context-status">
              <span
                className={`context-status-dot ${
                  runtimeContext.remoteStatus === 'disconnected' ? 'offline' : runtimeContext.remoteStatus ?? 'offline'
                }`}
              />
              <span className="context-status-text">{runtimeContext.remoteStatus ?? '--'}</span>
            </span>
          </div>
          <div className="session-context-fact">
            <span className="session-context-label">{t('control.rdxRuntimeCaptureFileId')}</span>
            <span className="session-context-value mono" title={runtimeContext.captureFileId ?? undefined}>
              {runtimeContext.captureFileId || '--'}
            </span>
          </div>
          <div className="session-context-fact">
            <span className="session-context-label">{t('control.rdxRuntimeCaptureId')}</span>
            <span className="session-context-value mono" title={runtimeContext.captureId ?? undefined}>
              {runtimeContext.captureId || '--'}
            </span>
          </div>
          <div className="session-context-fact">
            <span className="session-context-label">{t('control.rdxRuntimeUpdatedAt')}</span>
            <span className="session-context-value">{formatUpdatedAt(runtimeContext.updatedAt)}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default RdxRuntimeContextPanel;
