import React from 'react';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { InlineError } from '../../ui/InlineError';
import type { ComposerModelPickerOption } from './composerModelPicker';
import type { ComposerPickerProviderNotice, useComposerModelPickerOptions } from './useComposerModelPickerOptions';

type ProviderSection = ReturnType<typeof useComposerModelPickerOptions>['providerStates'][number];

/** One group per connected provider: its matching models and, when it has one, its loading or failure notice. */
export function ComposerModelList({ sections, loading, effective, saving, onSelect, onRetry }: {
  sections: ProviderSection[];
  loading: boolean;
  effective: { providerId: string; modelId: string } | null;
  saving: boolean;
  onSelect: (choice: { providerId: string; modelId: string }) => void;
  onRetry: (providerId: string) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      {sections.length === 0 ? (
        <p className="composer-model-empty">{t(loading ? 'composer.model.loading' : 'composer.model.empty')}</p>
      ) : (
        <div className="composer-model-list">
          {sections.map((section) => (
            <div key={section.id} className="composer-model-group" data-testid={`composer-model-provider-${section.id}`}>
              <p className="composer-model-group-label">{section.label}</p>
              {section.models.map((option) => {
                const selected = Boolean(
                  effective
                  && option.providerId === effective.providerId
                  && option.modelId === effective.modelId,
                );
                return (
                  <Button variant="ghost" size="sm"
                    key={`${option.providerId}:${option.modelId}`}
                    type="button"
                    className={`composer-model-item ${selected ? 'is-selected' : ''}`}
                    data-testid={`composer-model-item-${option.providerId}-${option.modelId}`}
                    role="menuitemradio"
                    disabled={saving}
                    aria-checked={selected}
                    onClick={() => onSelect({
                      providerId: option.providerId,
                      modelId: option.modelId,
                    })}
                  >
                    <span className="composer-model-item-text">
                      <span className="composer-model-item-label">{option.label}</span>
                      {option.contextWindowLabel ? (
                        <span className="composer-model-item-meta">{t('composer.model.contextWindow', { tokens: option.contextWindowLabel })}</span>
                      ) : null}
                    </span>
                    <ModelCapabilities option={option} />
                    {selected ? <Icon name="check" size={16} className="composer-model-check" /> : null}
                  </Button>
                );
              })}
              {section.notice ? (
                <ProviderNotice
                  notice={section.notice}
                  retrying={section.retrying}
                  onRetry={() => onRetry(section.id)}
                />
              ) : null}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** What a model can do, as quiet icons named on hover: image input, reasoning, Fast mode. */
const ModelCapabilities: React.FC<{ option: ComposerModelPickerOption }> = ({ option }) => {
  const { t } = useI18n();
  const capabilities = [
    option.hasVisionInput ? { icon: 'image' as const, label: t('composer.model.visionInput') } : null,
    option.hasReasoning ? { icon: 'brain' as const, label: t('composer.model.reasoning') } : null,
    option.hasFastMode ? { icon: 'lightning' as const, label: t('composer.model.fastChip') } : null,
  ].filter((capability) => capability !== null);
  if (capabilities.length === 0) return null;
  return (
    <span className="composer-model-capabilities">
      {capabilities.map((capability) => (
        <span key={capability.icon} className="composer-model-capability" data-tooltip={capability.label} aria-label={capability.label} role="img">
          <Icon name={capability.icon} size={14} />
        </span>
      ))}
    </span>
  );
};

const ProviderNotice: React.FC<{
  notice: ComposerPickerProviderNotice;
  retrying: boolean;
  onRetry: () => void;
}> = ({ notice, retrying, onRetry }) => {
  const { t } = useI18n();
  // The provider's own error text is technical; only "Copy details" carries it.
  if (notice.kind === 'failed') {
    return (
      <div className="composer-model-notice" data-notice={notice.kind}>
        <InlineError className="composer-model-notice-text" detail={notice.error}
          onRetry={onRetry} retryLabel={t('settings.retry')} retryDisabled={retrying}>
          {t('composer.model.refreshFailed')}
        </InlineError>
      </div>
    );
  }
  return (
    <div className="composer-model-notice" role="status" data-notice={notice.kind}>
      <span className="composer-model-notice-text">{t(notice.kind === 'loading' ? 'composer.model.loading' : 'composer.model.providerEmpty')}</span>
      {notice.kind === 'loading' ? null : (
        <Button variant="secondary" size="sm" disabled={retrying} onClick={onRetry}>{t('settings.retry')}</Button>
      )}
    </div>
  );
};
