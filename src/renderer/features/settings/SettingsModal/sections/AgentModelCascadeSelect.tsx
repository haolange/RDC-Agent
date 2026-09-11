import React, { useMemo, useState, type KeyboardEvent } from 'react';
import type { AgentModelOption } from '@shared/types/agentManifest';
import { formatPricePerMillion } from '@shared/utils/cost';
import type { useI18n } from '../../../../i18n';
import { Popover } from '../../../../ui/Popover';
import { SearchField } from '../../../../ui/SearchField';
import {
  agentModelOptionAccessibleLabel,
  buildAgentModelGroups,
  isAgentModelSelectionInvalid,
  resolveActiveProviderId,
} from './agentModelCascadeModel';

export { agentModelOptionAccessibleLabel, isAgentModelSelectionInvalid };

type Translate = ReturnType<typeof useI18n>['t'];

interface AgentModelCascadeSelectProps {
  value: string;
  options: AgentModelOption[];
  onChange: (value: string) => void;
  t: Translate;
}

export const AgentModelCascadeSelect: React.FC<AgentModelCascadeSelectProps> = ({
  value,
  options,
  onChange,
  t,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeProviderId, setActiveProviderId] = useState('');

  const selected = options.find((option) => option.canonicalId === value);
  const invalidSelection = isAgentModelSelectionInvalid(value, options);
  const groups = useMemo(() => buildAgentModelGroups(options, query), [options, query]);
  const resolvedProviderId = resolveActiveProviderId(groups, activeProviderId, selected?.providerId);
  const activeGroup = groups.find((group) => group.providerId === resolvedProviderId) ?? groups[0];

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const column = (event.target as HTMLElement)
      .closest('.settings-model-provider-list, .settings-model-submenu');
    if (!column) return;
    const items = Array.from(column.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    if (items.length === 0) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const index = event.key === 'Home' ? 0
      : event.key === 'End' ? items.length - 1
        : (current + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
    items[index]?.focus();
  };

  const selectOption = (option: AgentModelOption) => {
    onChange(option.canonicalId);
    setOpen(false);
    setQuery('');
  };

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
            aria-haspopup="dialog"
            aria-invalid={invalidSelection}
          >
            <span>{selected ? selected.providerLabel : t('settings.selectProviderPlaceholder')}</span>
            <strong>{selected ? selected.modelLabel : t('settings.selectModelPlaceholder')}</strong>
          </button>
        )}
      >
        <div className="settings-model-cascade-search">
          <SearchField
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onClear={() => setQuery('')}
            placeholder={t('settings.selectModelPlaceholder')}
            aria-label={t('settings.selectModelPlaceholder')}
            data-testid="settings-model-cascade-search"
          />
        </div>
        {groups.length === 0 ? (
          <div className="settings-model-empty" role="status">
            <strong>{t('settings.noModelsAvailable')}</strong>
            <p>{t('settings.modelEmptyHint')}</p>
          </div>
        ) : (
          <div className="settings-model-cascade-columns" onKeyDown={onMenuKeyDown}>
            <div className="settings-model-provider-list scrollbar-thin">
              {groups.map((group) => (
                <button
                  key={group.providerId}
                  type="button"
                  className={`settings-model-provider-trigger${group.providerId === resolvedProviderId ? ' is-selected' : ''}`}
                  data-provider-id={group.providerId}
                  aria-pressed={group.providerId === resolvedProviderId}
                  onClick={() => setActiveProviderId(group.providerId)}
                >
                  <span>{group.label}</span>
                  <span>{group.availableCount}</span>
                </button>
              ))}
            </div>
            <div
              className="settings-model-submenu scrollbar-thin"
              role="listbox"
              aria-label={activeGroup?.label}
            >
              {activeGroup?.options.map((option) => {
                const accessibleLabel = agentModelOptionAccessibleLabel(
                  option,
                  t('settings.modelUnavailable'),
                );
                return (
                  <button
                    key={option.canonicalId}
                    type="button"
                    className={`settings-model-option${option.canonicalId === value ? ' is-selected' : ''}`}
                    data-provider-id={option.providerId}
                    data-model-id={option.modelId}
                    data-canonical-id={option.canonicalId}
                    disabled={!option.configured}
                    role="option"
                    aria-label={accessibleLabel}
                    aria-selected={option.canonicalId === value}
                    title={accessibleLabel}
                    onClick={() => selectOption(option)}
                  >
                    <span className="settings-model-option-label">{option.modelLabel}</span>
                    {option.custom ? (
                      <span
                        className="settings-model-option-custom"
                        data-testid={`settings-model-option-custom-${option.canonicalId}`}
                      >
                        {t('settings.modelCustomBadge')}
                      </span>
                    ) : null}
                    {!option.configured ? (
                      <span className="settings-model-option-reason">
                        {option.disabledReason ?? t('settings.modelUnavailable')}
                      </span>
                    ) : option.cost ? (
                      <span className="settings-model-option-cost">
                        {formatPricePerMillion(option.cost.input)} / {formatPricePerMillion(option.cost.output)}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </Popover>
      {invalidSelection ? (
        <small className="settings-model-cascade-invalid" data-testid="settings-agent-model-invalid">
          {t('settings.routeReasonModelInvalid')}: {value}
        </small>
      ) : null}
    </div>
  );
};
