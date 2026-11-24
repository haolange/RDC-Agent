import React, { useState } from 'react';
import { DEFAULT_AGENT_RUNTIME } from '@shared/constants/appSettingsDefaults';
import { useI18n } from '../../../../i18n';
import { useAppSettingsStore } from '../../../../stores/appSettingsStore';
import { Button } from '../../../../ui/Button';
import { Textarea } from '../../../../ui/Textarea';
import { SettingsField, SettingsSection } from '../parts';

const ruleFields = [
  ['readableRoots', 'settings.customPermissionReadableRoots'],
  ['writableRoots', 'settings.customPermissionWritableRoots'],
  ['allowedCommandPrefixes', 'settings.customPermissionAllowedPrefixes'],
  ['deniedCommandPrefixes', 'settings.customPermissionDeniedPrefixes'],
] as const;

function lines(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export const CustomPermissionFields: React.FC = () => {
  const { t } = useI18n();
  const saved = useAppSettingsStore((state) => state.settings.agentRuntime?.permissions ?? DEFAULT_AGENT_RUNTIME.permissions);
  const save = useAppSettingsStore((state) => state.setCustomPermissionRules);
  const [draft, setDraft] = useState(() => ({
    readableRoots: saved.readableRoots.join('\n'),
    writableRoots: saved.writableRoots.join('\n'),
    allowedCommandPrefixes: saved.allowedCommandPrefixes.join('\n'),
    deniedCommandPrefixes: saved.deniedCommandPrefixes.join('\n'),
  }));
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const statusText = status === 'saving'
    ? t('settings.customPermissionSaving')
    : status === 'saved'
      ? t('settings.customPermissionSaved')
      : status === 'error'
        ? t('settings.customPermissionError')
        : '';
  const dirty = ruleFields.some(([field]) => lines(draft[field]).join('\n') !== saved[field].join('\n'));

  return (
    <SettingsSection
      variant="rows"
      className="settings-permission-rules"
      title={t('settings.customPermissionTitle')}
      description={t('settings.customPermissionHint')}
      data-testid="settings-custom-permissions"
    >
      {ruleFields.map(([field, label]) => (
        <SettingsField key={field} label={t(label)} htmlFor={`settings-permission-${field}`}>
          <Textarea id={`settings-permission-${field}`} sizing="content" value={draft[field]} disabled={status === 'saving'}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setStatus('idle');
              setDraft(current => ({ ...current, [field]: value }));
            }} />
        </SettingsField>
      ))}
      {dirty || status !== 'idle' ? <div className="settings-actions settings-actions-split">
        <span className="settings-save-status" role="status" data-status={status}>{statusText}</span>
        {dirty || status === 'saving' ? <Button
          variant="primary"
          size="sm"
          disabled={status === 'saving'}
          onClick={() => {
            setStatus('saving');
            void save({
              readableRoots: lines(draft.readableRoots),
              writableRoots: lines(draft.writableRoots),
              allowedCommandPrefixes: lines(draft.allowedCommandPrefixes),
              deniedCommandPrefixes: lines(draft.deniedCommandPrefixes),
            }).then(() => setStatus('saved')).catch(() => setStatus('error'));
          }}
        >
          {t('settings.customPermissionSave')}
        </Button> : null}
      </div> : null}
    </SettingsSection>
  );
};
