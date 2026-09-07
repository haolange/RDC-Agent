import React from 'react';
import type { RdxRuntimeOverview } from '@shared/types/rdxRuntime';
import type { TranslationKey, useI18n } from '../../../../i18n';
import { copyAppText, openAppPath } from '../../../../hooks/appShellBridge';
import { Button } from '../../../../ui/Button';
import { EmptyState } from '../../../../ui/EmptyState';
import { SettingsField, SettingsSection } from '../parts';

type Translate = ReturnType<typeof useI18n>['t'];

const PATH_LABEL_KEYS: Record<string, TranslationKey> = {
  configPath: 'settings.configPath',
  instructionsPath: 'settings.instructionsPath',
  agentsPath: 'settings.agentsPath',
  skillsPath: 'settings.skillsPath',
  mcpPath: 'settings.mcpPath',
  hooksPath: 'settings.hooksPath',
  policiesPath: 'settings.policiesPath',
  knowledgePath: 'settings.knowledgePath',
  memoryPath: 'settings.memoryPath',
};

const pathLabel = (t: Translate, key: string): string => {
  const labelKey = PATH_LABEL_KEYS[key];
  return labelKey ? t(labelKey) : key;
};

export const WorkspaceSettings: React.FC<{ overview: RdxRuntimeOverview | null; loading: boolean; error: string; t: Translate }> = ({ overview, loading, error, t }) => {
  const renderPaths = (title: string, paths?: Record<string, string>) => (
    <SettingsSection title={title} className="settings-space-card">
      <div className="settings-space-list">
        {paths ? Object.entries(paths).filter(([key]) => !['projectRoot', 'userRdxRoot'].includes(key)).map(([key, value]) => (
          <div className="settings-space-row" key={key}>
            <div className="settings-space-row-copy">
              <span>{pathLabel(t, key)}</span>
              <code title={value}>{value}</code>
            </div>
            <div className="settings-space-row-actions">
              <Button variant="secondary" size="sm" onClick={() => void openAppPath(value)}>{t('settings.reveal')}</Button>
              <Button variant="secondary" size="sm" onClick={() => void copyAppText(value)}>{t('settings.copy')}</Button>
            </div>
          </div>
        )) : (
          <EmptyState title={t('settings.workspaceProjectEmpty')} />
        )}
      </div>
    </SettingsSection>
  );

  return (
    <section className="settings-page settings-page-workspace" data-settings-search="workspace">
      <div className="settings-workspace-page scrollbar-thin" data-testid="settings-workspace-body">
        <SettingsSection title={t('settings.workspaceRuntimeRoot')} className="settings-workspace-root-card" data-settings-search="runtime-root">
          <SettingsField label={t('settings.workspaceRuntimeRoot')} layout="row">
            <div className="settings-workspace-root-value settings-path-value">
              {overview?.userRoot ?? (loading ? t('settings.pathLoading') : t('settings.pathUnavailable'))}
            </div>
          </SettingsField>
          <div className="settings-path-actions settings-workspace-root-actions">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => overview?.userRoot && void openAppPath(overview.userRoot)}
            >
              {t('settings.reveal')}
            </Button>
          </div>
        </SettingsSection>
        {error ? <EmptyState title={error} /> : null}
        <div className="settings-space-stack">
          {renderPaths(t('settings.workspaceUserScope'), overview?.userPaths)}
          {renderPaths(t('settings.workspaceProjectScope'), overview?.projectPaths)}
        </div>
        <SettingsSection title={t('settings.workspaceStores')} className="settings-space-card">
          <div className="settings-space-list">
            <div className="settings-space-row">
              <div className="settings-space-row-copy">
                <span>{t('settings.knowledgePath')}</span>
                <code>{overview?.knowledge.userPath}</code>
              </div>
            </div>
            <div className="settings-space-row">
              <div className="settings-space-row-copy">
                <span>{t('settings.memoryPath')}</span>
                <code>{overview?.memory.userPath}</code>
              </div>
            </div>
          </div>
        </SettingsSection>
      </div>
    </section>
  );
};
