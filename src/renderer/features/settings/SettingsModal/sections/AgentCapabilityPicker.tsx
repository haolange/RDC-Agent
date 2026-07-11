import React, { useState } from 'react';
import type { useI18n } from '../../../../i18n';

type Translate = ReturnType<typeof useI18n>['t'];

export interface AgentCapabilityGroup {
  id: string;
  label: string;
  values: string[];
  options: string[];
  onChange: (values: string[]) => void;
}

interface AgentCapabilityPickerProps {
  groups: AgentCapabilityGroup[];
  t: Translate;
}

const normalizeCapability = (value: string): string => value.trim();

const uniqueCapabilities = (values: string[]): string[] =>
  Array.from(new Set(values.map(normalizeCapability).filter(Boolean)));

export const AgentCapabilityPicker: React.FC<AgentCapabilityPickerProps> = ({ groups, t }) => {
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const setDraft = (groupId: string, value: string) => {
    setDrafts((current) => ({ ...current, [groupId]: value }));
  };

  const toggleValue = (group: AgentCapabilityGroup, option: string) => {
    const selected = new Set(group.values);
    if (selected.has(option)) {
      selected.delete(option);
    } else {
      selected.add(option);
    }
    group.onChange(uniqueCapabilities(Array.from(selected)));
  };

  const addCustomValue = (group: AgentCapabilityGroup) => {
    const next = normalizeCapability(drafts[group.id] ?? '');
    if (!next) return;
    group.onChange(uniqueCapabilities([...group.values, next]));
    setDraft(group.id, '');
  };

  return (
    <div className="settings-capability-picker">
      {groups.map((group) => {
        const options = uniqueCapabilities([...group.options, ...group.values]);
        return (
          <section key={group.id} className="settings-capability-group">
            <div className="settings-capability-group-head">
              <strong>{group.label}</strong>
              <span>{t('settings.agentCapabilitySelected', { count: String(group.values.length) })}</span>
            </div>

            <div className="settings-capability-options" role="group" aria-label={group.label}>
              {options.length > 0 ? options.map((option) => (
                <label key={option} className="settings-capability-option">
                  <input
                    type="checkbox"
                    checked={group.values.includes(option)}
                    onChange={() => toggleValue(group, option)}
                  />
                  <span>{option}</span>
                </label>
              )) : (
                <div className="settings-empty settings-empty-dashed">{t('settings.noCapabilityOptions')}</div>
              )}
            </div>

            <form
              className="settings-capability-custom"
              onSubmit={(event) => {
                event.preventDefault();
                addCustomValue(group);
              }}
            >
              <input
                className="input"
                value={drafts[group.id] ?? ''}
                placeholder={t('settings.addCapabilityPlaceholder')}
                onChange={(event) => setDraft(group.id, event.currentTarget.value)}
              />
              <button type="submit" className="button button-secondary">
                {t('settings.add')}
              </button>
            </form>
          </section>
        );
      })}
    </div>
  );
};
