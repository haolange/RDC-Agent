import React, { useMemo, useState, type KeyboardEvent } from 'react';
import type { AgentModelOption } from '@shared/types/agentManifest';
import { formatPricePerMillion } from '@shared/utils/cost';
import type { useI18n } from '../../../../i18n';
import { Icon } from '../../../../ui/Icon';
import { Popover } from '../../../../ui/Popover';
import { SearchField } from '../../../../ui/SearchField';
import {
  agentModelOptionAccessibleLabel,
  buildAgentModelGroups,
  isAgentModelSelectionInvalid,
} from './agentModelCascadeModel';

export { agentModelOptionAccessibleLabel, isAgentModelSelectionInvalid };

type Translate = ReturnType<typeof useI18n>['t'];

interface AgentModelCascadeSelectProps {
  value: string;
  options: AgentModelOption[];
  onChange: (value: string) => void;
  /**
   * Handoff-only: offers "use the target Agent's model" as the first entry. An empty value
   * means inherit. Never set for an Agent's own route, where a model is always explicit.
   */
  inherit?: { label: string; description: string };
  t: Translate;
}

/**
 * Single searchable list grouped by provider: label + canonical id per row, a check on
 * the selected row, and the real disabled reason on unavailable rows.
 */
export const AgentModelCascadeSelect: React.FC<AgentModelCascadeSelectProps> = ({
  value,
  options,
  onChange,
  inherit,
  t,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = options.find((option) => option.canonicalId === value);
  const inheriting = Boolean(inherit) && !value;
  const invalidSelection = isAgentModelSelectionInvalid(value, options);
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

  const triggerPrimary = inheriting
    ? inherit?.label
    : selected ? selected.modelLabel : t('settings.selectModelPlaceholder');
  const triggerSecondary = inheriting
    ? null
    : selected ? selected.canonicalId : t('settings.selectProviderPlaceholder');

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
              {triggerSecondary ? <span>{triggerSecondary}</span> : null}
            </span>
            <Icon name="chevron-down" size={14} />
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
        {groups.length === 0 && !inherit ? (
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
            {inherit ? (
              <button
                type="button"
                role="option"
                aria-selected={inheriting}
                className={`settings-model-option${inheriting ? ' is-selected' : ''}`}
                data-testid="settings-model-option-inherit"
                onClick={() => select('')}
              >
                <span className="settings-model-option-copy">
                  <span className="settings-model-option-label">{inherit.label}</span>
                  <span className="settings-model-option-id">{inherit.description}</span>
                </span>
                {inheriting ? <Icon name="check" size={14} className="settings-model-option-check" /> : null}
              </button>
            ) : null}
            {groups.length === 0 ? (
              <div className="settings-model-empty" role="status">
                <strong>{t('settings.noModelsAvailable')}</strong>
                <p>{t('settings.modelEmptyHint')}</p>
              </div>
            ) : null}
            {groups.map((group) => (
              <div key={group.providerId} className="settings-model-group" role="group" aria-label={group.label} data-provider-id={group.providerId}>
                <div className="settings-model-group-title">
                  <span>{group.label}</span>
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
                      disabled={!option.configured}
                      role="option"
                      aria-label={accessibleLabel}
                      aria-selected={selectedRow}
                      title={accessibleLabel}
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
                        <span className="settings-model-option-id">{option.canonicalId}</span>
                      </span>
                      {!option.configured ? (
                        <span className="settings-model-option-reason">
                          {t('settings.modelUnavailable')}: {option.disabledReason ?? t('settings.modelUnavailable')}
                        </span>
                      ) : option.cost ? (
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
        <small className="settings-model-cascade-invalid" data-testid="settings-agent-model-invalid">
          {t('settings.routeReasonModelInvalid')}: {value}
        </small>
      ) : null}
    </div>
  );
};
