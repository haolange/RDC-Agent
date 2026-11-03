import React, { useState } from 'react';
import type { AgentPermissionSettings } from '@shared/types/settings';
import { useI18n } from '../../../../i18n';
import { useAppSettingsStore } from '../../../../stores/appSettingsStore';
import { DEFAULT_SETTINGS } from '../../../../stores/defaultAppSettings';
import { Button } from '../../../../ui/Button';
import { Textarea } from '../../../../ui/Textarea';
import { SettingsField, SettingsSection } from '../parts';

type CustomRules = Pick<AgentPermissionSettings, 'readableRoots' | 'writableRoots' | 'allowedCommandPrefixes' | 'deniedCommandPrefixes'>;

function lines(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export const CustomPermissionFields: React.FC = () => {
  const { t } = useI18n();
  const saved = useAppSettingsStore((state) => state.settings.agentRuntime?.permissions ?? DEFAULT_SETTINGS.agentRuntime.permissions);
  const save = useAppSettingsStore((state) => state.setCustomPermissionRules);
  const [draft, setDraft] = useState<CustomRules>({
    readableRoots: saved.readableRoots,
    writableRoots: saved.writableRoots,
    allowedCommandPrefixes: saved.allowedCommandPrefixes,
    deniedCommandPrefixes: saved.deniedCommandPrefixes,
  });
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const statusText = status === 'saving'
    ? t('settings.customPermissionSaving')
    : status === 'saved'
      ? t('settings.customPermissionSaved')
      : status === 'error'
        ? t('settings.customPermissionError')
        : '';
  const edit = (patch: Partial<CustomRules>) => {
    setStatus('idle');
    setDraft((current) => ({ ...current, ...patch }));
  };

  return (
    <SettingsSection
      title={t('settings.customPermissionTitle')}
      description={t('settings.customPermissionHint')}
      data-testid="settings-custom-permissions"
    >
      <SettingsField label={t('settings.customPermissionReadableRoots')} layout="stack">
        <Textarea sizing="content" value={draft.readableRoots.join('\n')} onChange={(event) => edit({ readableRoots: lines(event.currentTarget.value) })} />
      </SettingsField>
      <SettingsField label={t('settings.customPermissionWritableRoots')} layout="stack">
        <Textarea sizing="content" value={draft.writableRoots.join('\n')} onChange={(event) => edit({ writableRoots: lines(event.currentTarget.value) })} />
      </SettingsField>
      <SettingsField label={t('settings.customPermissionAllowedPrefixes')} layout="stack">
        <Textarea sizing="content" value={draft.allowedCommandPrefixes.join('\n')} onChange={(event) => edit({ allowedCommandPrefixes: lines(event.currentTarget.value) })} />
      </SettingsField>
      <SettingsField label={t('settings.customPermissionDeniedPrefixes')} layout="stack">
        <Textarea sizing="content" value={draft.deniedCommandPrefixes.join('\n')} onChange={(event) => edit({ deniedCommandPrefixes: lines(event.currentTarget.value) })} />
      </SettingsField>
      <div className="settings-profile-actions">
        <span className="settings-save-status" role="status" data-status={status}>{statusText}</span>
        <Button
          variant="secondary"
          size="sm"
          disabled={status === 'saving'}
          onClick={() => {
            setStatus('saving');
            void save(draft).then(() => setStatus('saved')).catch(() => setStatus('error'));
          }}
        >
          {t('settings.customPermissionSave')}
        </Button>
      </div>
    </SettingsSection>
  );
};
