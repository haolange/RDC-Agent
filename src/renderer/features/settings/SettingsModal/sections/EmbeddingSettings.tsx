import React, { useCallback, useEffect, useState } from 'react';
import type { EmbeddingCatalog, EmbeddingSettings as EmbeddingSelection, SemanticLaneStatus } from '@shared/types/embedding';
import { DEFAULT_EMBEDDING_SETTINGS, embeddingIdentity } from '@shared/types/embedding';
import { useI18n } from '../../../../i18n';
import { useAppSettingsStore } from '../../../../stores/appSettingsStore';

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

  const refreshLane = useCallback(async () => {
    setLane(await window.electronAPI.settings.getSemanticLaneStatus());
  }, []);

  useEffect(() => {
    let cancelled = false;
    void window.electronAPI.settings.getEmbeddingCatalog().then((next) => {
      if (!cancelled) setCatalog(next);
    });
    void refreshLane();
    return () => {
      cancelled = true;
    };
  }, [refreshLane, embedding.providerId, embedding.modelId, embedding.allowKnowledgeUpload]);

  const selectedValue = embedding.providerId && embedding.modelId
    ? embeddingIdentity(embedding.providerId, embedding.modelId)
    : '';

  const persist = async (next: Partial<EmbeddingSelection>) => {
    await patchSettings({
      llm: {
        embedding: {
          ...embedding,
          ...next,
        },
      },
    });
    await refreshLane();
  };

  const statusKey = lane?.availability === 'ready'
    ? 'settings.embeddingStatusReady'
    : lane?.availability === 'stale'
      ? 'settings.embeddingStatusStale'
      : 'settings.embeddingStatusUnavailable';

  return (
    <div className="settings-browser-block settings-tool-card" data-settings-search="embedding" data-testid="settings-embedding">
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
            const identity = embeddingIdentity(model.providerId, model.modelId);
            return (
              <option key={identity} value={identity}>
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
          onChange={(event) => {
            void persist({ allowKnowledgeUpload: event.currentTarget.checked });
          }}
        />
        {t('settings.embeddingConsent')}
      </label>
      <p className="settings-help-text">{t('settings.embeddingConsentHint')}</p>
      <p className="settings-help-text" data-testid="settings-embedding-status">
        {t(statusKey)}
      </p>
      {lane?.availability === 'stale' && (
        <button
          type="button"
          className="button button-secondary"
          data-testid="settings-embedding-rebuild"
          disabled={rebuilding}
          onClick={() => {
            setRebuilding(true);
            void window.electronAPI.settings.rebuildSemanticIndex()
              .then((next) => setLane(next))
              .finally(() => setRebuilding(false));
          }}
        >
          {t('settings.embeddingRebuild')}
        </button>
      )}
    </div>
  );
};
