import React, { useCallback, useEffect, useState } from 'react';
import type { EmbeddingCatalog, EmbeddingSettings as EmbeddingSelection, SemanticLaneStatus } from '@shared/types/embedding';
import { DEFAULT_EMBEDDING_SETTINGS, embeddingIdentity } from '@shared/types/embedding';
import {
  embeddingAvailabilityKey,
  embeddingAvailabilityOf,
  isSemanticLaneReady,
  semanticReasonKey,
} from '../../../embedding/semanticLaneCopy';
import { useI18n } from '../../../../i18n';
import { Button } from '../../../../ui/Button';
import { useAppSettingsStore } from '../../../../stores/appSettingsStore';
import { serviceErrorMessage } from '../../../../lib/serviceErrorMessage';

function selectionOf(value: EmbeddingSelection | undefined): EmbeddingSelection {
  return value ?? DEFAULT_EMBEDDING_SETTINGS;
}

export const EmbeddingSettings: React.FC = () => {
  const { t } = useI18n();
  const embedding = useAppSettingsStore((state) => selectionOf(state.settings.llm.embedding));
  const patchSettings = useAppSettingsStore((state) => state.patchSettings);
  const [catalog, setCatalog] = useState<EmbeddingCatalog | null>(null);
  const [lane, setLane] = useState<SemanticLaneStatus | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshLane = useCallback(async () => {
    setLane(await window.electronAPI.settings.getSemanticLaneStatus());
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void window.electronAPI.settings.getEmbeddingCatalog().then((next) => {
      if (!cancelled) setCatalog(next);
    }).catch((err: unknown) => {
      if (!cancelled) setError(serviceErrorMessage(err));
    });
    void refreshLane().catch((err: unknown) => {
      if (!cancelled) setError(serviceErrorMessage(err));
    });
    return () => {
      cancelled = true;
    };
  }, [refreshLane, embedding.providerId, embedding.modelId, embedding.allowKnowledgeUpload]);

  const selectedValue = embedding.providerId && embedding.modelId
    ? embeddingIdentity(embedding.providerId, embedding.modelId)
    : '';
  const availability = embeddingAvailabilityOf(lane);
  const ready = isSemanticLaneReady(lane);
  const identity = lane?.selectedIdentity ?? (selectedValue || null);

  const persist = async (next: Partial<EmbeddingSelection>) => {
    setError(null);
    try {
      await patchSettings({
        llm: {
          embedding: {
            ...embedding,
            ...next,
          },
        },
      });
      await refreshLane();
    } catch (err) {
      setError(serviceErrorMessage(err));
    }
  };

  const rebuild = async () => {
    setRebuilding(true);
    setError(null);
    try {
      setLane(await window.electronAPI.settings.rebuildSemanticIndex());
    } catch (err) {
      setError(serviceErrorMessage(err));
    } finally {
      setRebuilding(false);
    }
  };

  return (
    <div
      className="settings-browser-block settings-tool-card"
      data-settings-search="embedding"
      data-testid="settings-embedding"
      aria-busy={rebuilding || undefined}
    >
      <div className="settings-browser-section-head">
        <div>
          <div className="settings-browser-section-title">{t('settings.embeddingTitle')}</div>
          <div className="settings-help-text">{t('settings.embeddingHint')}</div>
        </div>
      </div>
      <label className="settings-field">
        <span className="settings-field-label">{t('settings.embeddingModel')}</span>
        <select
          className="input"
          value={selectedValue}
          data-testid="settings-embedding-model"
          disabled={rebuilding}
          onChange={(event) => {
            const value = event.currentTarget.value;
            if (!value) {
              void persist({ providerId: null, modelId: null });
              return;
            }
            const separator = value.indexOf(':');
            void persist({
              providerId: value.slice(0, separator),
              modelId: value.slice(separator + 1),
            });
          }}
        >
          <option value="">{t('settings.embeddingModelNone')}</option>
          {(catalog?.models ?? []).map((model) => {
            const optionIdentity = embeddingIdentity(model.providerId, model.modelId);
            return (
              <option key={optionIdentity} value={optionIdentity}>
                {model.label} · {model.dimensions}d
              </option>
            );
          })}
        </select>
      </label>
      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={embedding.allowKnowledgeUpload}
          data-testid="settings-embedding-consent"
          disabled={rebuilding}
          onChange={(event) => {
            void persist({ allowKnowledgeUpload: event.currentTarget.checked });
          }}
        />
        {t('settings.embeddingConsent')}
      </label>
      <p className="settings-help-text">{t('settings.embeddingConsentHint')}</p>
      <p className="settings-help-text" data-testid="settings-embedding-identity">
        {identity
          ? t('settings.embeddingIdentity', {
            identity,
            dimensions: lane?.selectedDimensions ?? '—',
          })
          : t('settings.embeddingIdentityNone')}
      </p>
      {lane?.snapshot && lane.availability === 'stale' && lane.snapshot.identity !== identity && (
        <p className="settings-help-text" data-testid="settings-embedding-snapshot-identity">
          {t('settings.embeddingSnapshotIdentity', { identity: lane.snapshot.identity })}
        </p>
      )}
      <p
        className="settings-help-text settings-embedding-status"
        data-testid="settings-embedding-status"
        data-availability={availability}
        data-reason={lane?.reason ?? 'unconfigured'}
        data-ready={ready ? 'true' : 'false'}
      >
        {t(embeddingAvailabilityKey(lane))}
        {lane && !ready ? ` · ${t(semanticReasonKey(lane))}` : ''}
      </p>
      {error && (
        <p className="settings-handoff-error" role="alert" data-testid="settings-embedding-error">
          {error}
        </p>
      )}
      {availability === 'stale' && (
        <Button
          variant="secondary"
          data-testid="settings-embedding-rebuild"
          disabled={rebuilding}
          onClick={() => void rebuild()}
        >
          {rebuilding ? t('settings.embeddingRebuildBusy') : t('settings.embeddingRebuild')}
        </Button>
      )}
    </div>
  );
};
