import React, { useMemo, useState, type KeyboardEvent } from 'react';
import { formatPricePerMillion } from '@shared/utils/cost';
import { Icon } from '../../../../ui/Icon';
import { Chevron } from '../../../../ui/Chevron';
import { Popover } from '../../../../ui/Popover';
import { SearchField } from '../../../../ui/SearchField';
import { useI18n } from '../../../../i18n';
import { ProviderMark } from './ProviderMark';
import {
  agentModelOptionAccessibleLabel,
  buildAgentModelGroups,
  isAgentModelSelectionInvalid,
} from './agentModelCascadeModel';
import type { AgentModelOption } from '@shared/types/agentManifest';

export { agentModelOptionAccessibleLabel, isAgentModelSelectionInvalid };

interface AgentModelCascadeSelectProps {
  value: string;
  options: AgentModelOption[];
  /** For one Agent: the first choice follows the default model, named in this label; choosing it clears the value. */
  followDefaultLabel?: string;
  onChange: (value: string) => void;
}

/**
 * Searchable executable models grouped by provider, with stable canonical identities.
 */
export const AgentModelCascadeSelect: React.FC<AgentModelCascadeSelectProps> = ({
  value,
  options,
  followDefaultLabel,
  onChange,
}) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = options.find((option) => option.canonicalId === value
    && (option.configured || option.status === 'provider-unavailable'));
  const invalidSelection = isAgentModelSelectionInvalid(value, options);
  const providerUnavailable = selected?.status === 'provider-unavailable';
  const groups = useMemo(() => buildAgentModelGroups(options, query), [options, query]);

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const list = event.currentTarget;
    const items = Array.from(list.querySelectorAll<HTMLButtonElement>('button[role="option"]:not(:disabled)'));
    if (items.length === 0) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const index = event.key === 'Home' ? 0
      : event.key === 'End' ? items.length - 1
        : (current + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
    items[index]?.focus();
  };

  const select = (canonicalId: string) => {
    onChange(canonicalId);
    setOpen(false);
    setQuery('');
  };

  const triggerPrimary = selected ? selected.modelLabel
    : invalidSelection ? t('composer.model.unavailable')
      : followDefaultLabel ?? t('settings.selectModelPlaceholder');
  const followsDefault = Boolean(followDefaultLabel) && !value;

  return (
    <div className="settings-model-cascade">
      <Popover
        open={open}
        onOpenChange={setOpen}
        align="start"
        className="settings-model-cascade-menu"
        trigger={(
          <button
            type="button"
            className="settings-model-cascade-trigger"
            data-testid="settings-model-cascade-trigger"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-invalid={invalidSelection}
          >
            <span className="settings-model-cascade-trigger-copy">
              <strong>{triggerPrimary}</strong>
              {selected ? <span className="settings-service-title"><ProviderMark id={selected.providerId} size={14} />{selected.providerLabel}</span> : null}
            </span>
            <Chevron direction="down" />
          </button>
        )}
      >
        <div className="settings-model-cascade-search">
          <SearchField
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onClear={() => setQuery('')}
            clearLabel={t('app.clearSearch')}
            placeholder={t('settings.searchModelPlaceholder')}
            aria-label={t('settings.searchModelPlaceholder')}
            data-testid="settings-model-cascade-search"
          />
        </div>
        {followDefaultLabel && !query ? (
          <div className="settings-model-cascade-list" role="listbox" aria-label={t('settings.modelFieldLabel')} onKeyDown={onMenuKeyDown}>
            <button
              type="button"
              className={`settings-model-option settings-model-option--default${followsDefault ? ' is-selected' : ''}`}
              role="option"
              aria-selected={followsDefault}
              data-testid="settings-model-option-default"
              onClick={() => select('')}
            >
              <span className="settings-model-option-copy">
                <span className="settings-model-option-label">{followDefaultLabel}</span>
              </span>
              {followsDefault ? <Icon name="check" size={14} className="settings-model-option-check" /> : null}
            </button>
          </div>
        ) : null}
        {groups.length === 0 ? (
          <div className="settings-model-empty" role="status">
            <strong>{t('settings.noModelsAvailable')}</strong>
            <p>{t('settings.modelEmptyHint')}</p>
          </div>
        ) : (
          <div
            className="settings-model-cascade-list scrollbar-thin"
            role="listbox"
            aria-label={t('settings.modelFieldLabel')}
            onKeyDown={onMenuKeyDown}
          >
            {groups.map((group) => (
              <div key={group.providerId} className="settings-model-group" role="group" aria-label={group.label} data-provider-id={group.providerId}>
                <div className="settings-model-group-title">
                  <span className="settings-service-title"><ProviderMark id={group.providerId} size={16} />{group.label}</span>
                  <span>{group.availableCount}</span>
                </div>
                {group.options.map((option) => {
                  const accessibleLabel = agentModelOptionAccessibleLabel(option, t('settings.modelUnavailable'));
                  const selectedRow = option.canonicalId === value;
                  return (
                    <button
                      key={option.canonicalId}
                      type="button"
                      className={`settings-model-option${selectedRow ? ' is-selected' : ''}`}
                      data-provider-id={option.providerId}
                      data-model-id={option.modelId}
                      data-canonical-id={option.canonicalId}
                      role="option"
                      aria-label={accessibleLabel}
                      aria-selected={selectedRow}
                      data-tooltip={option.disabledReason}
                      onClick={() => select(option.canonicalId)}
                    >
                      <span className="settings-model-option-copy">
                        <span className="settings-model-option-label">
                          {option.modelLabel}
                          {option.custom ? (
                            <span
                              className="settings-model-option-custom"
                              data-testid={`settings-model-option-custom-${option.canonicalId}`}
                            >
                              {t('settings.modelCustomBadge')}
                            </span>
                          ) : null}
                        </span>
                      </span>
                      {option.cost ? (
                        <span className="settings-model-option-cost">
                          {formatPricePerMillion(option.cost.input)} / {formatPricePerMillion(option.cost.output)}
                        </span>
                      ) : null}
                      {selectedRow ? <Icon name="check" size={14} className="settings-model-option-check" /> : null}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </Popover>
      {invalidSelection ? (
        <p className="settings-model-cascade-invalid" data-testid="settings-agent-model-invalid" role="status">
          {providerUnavailable ? t('settings.routeReasonProviderUnavailable') : t('settings.routeReasonModelInvalid')}
        </p>
      ) : null}
    </div>
  );
};
