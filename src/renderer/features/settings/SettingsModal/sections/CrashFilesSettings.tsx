import React, { useCallback } from 'react';
import { Button } from '../../../../ui/Button';
import { formatBytes } from '../../../../lib/formatBytes';
import { notify } from '../../../../stores/notificationStore';
import { SettingsField, SettingsSection } from '../parts';
import { useI18n } from '../../../../i18n';
import { useCrashFiles } from './useCrashFiles';

/** Settings › General › Crash reports: the minidumps kept on this computer, with one action to remove them. */
export const CrashFilesSettings: React.FC = () => {
  const { t, language } = useI18n();
  const onClearFailed = useCallback(
    (error: unknown) => notify.failure(error, t, 'settings.crashFilesClearFailed'),
    [t],
  );
  const { summary, clearing, clear } = useCrashFiles(onClearFailed);
  const description = !summary
    ? '—'
    : summary.count === 0
      ? t('settings.crashFilesNone')
      : t(summary.count === 1 ? 'settings.crashFilesSummaryOne' : 'settings.crashFilesSummary', {
          count: summary.count,
          size: formatBytes(summary.bytes, language),
        });
  return (
    <SettingsSection variant="rows" title={t('settings.crashReports')} data-settings-search="crash-files">
      <SettingsField
        layout="row"
        label={t('settings.crashFiles')}
        description={description}
        search="crash-files"
        testId="settings-crash-files"
      >
        <Button
          size="sm"
          variant="secondary"
          loading={clearing}
          disabled={!summary || summary.count === 0 || clearing}
          onClick={() => void clear()}
        >
          {t('settings.crashFilesClear')}
        </Button>
      </SettingsField>
    </SettingsSection>
  );
};
