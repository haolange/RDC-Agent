import React from 'react';
import type { RdxRuntimeOverview } from '@shared/types/rdxRuntime';
import type { TranslationKey, useI18n } from '../../../../i18n';
import { getElectronApi } from '../../../../platform/getElectronApi';

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
  const renderPaths = (title: string, paths?: Record<string, string>) => <div className="settings-space-card">
    <div className="settings-space-card-head"><strong>{title}</strong></div>
    <div className="settings-space-list">
      {paths ? Object.entries(paths).filter(([key]) => !['projectRoot', 'userRdxRoot'].includes(key)).map(([key, value]) => <div className="settings-space-row" key={key}>
        <div className="settings-space-row-copy"><span>{pathLabel(t, key)}</span><code title={value}>{value}</code></div>
        <div className="settings-space-row-actions">
          <button type="button" className="button button-secondary" onClick={() => void getElectronApi()?.appShell.openPath(value)}>{t('settings.reveal')}</button>
          <button type="button" className="button button-secondary" onClick={() => void getElectronApi()?.appShell.copyText(value)}>{t('settings.copy')}</button>
        </div>
      </div>) : <div className="settings-empty">{t('settings.workspaceProjectEmpty')}</div>}
    </div>
  </div>;

  return <section className="settings-page settings-page-workspace">
    <div className="settings-workspace-page scrollbar-thin" data-testid="settings-workspace-body">
      <div className="settings-workspace-hero settings-workspace-root-card">
        <div className="settings-workspace-hero-copy"><div className="settings-field-label">{t('settings.workspaceRuntimeRoot')}</div></div>
        <div className="settings-path-value settings-workspace-root-value">{overview?.userRoot ?? (loading ? t('settings.pathLoading') : t('settings.pathUnavailable'))}</div>
        <div className="settings-path-actions settings-workspace-root-actions"><button type="button" className="button button-secondary" onClick={() => overview?.userRoot && void getElectronApi()?.appShell.openPath(overview.userRoot)}>{t('settings.reveal')}</button></div>
      </div>
      {error && <div className="settings-path-card settings-workspace-note-card"><div className="settings-workspace-note-list"><div className="settings-workspace-note-item">{error}</div></div></div>}
      <div className="settings-space-stack">
        {renderPaths(t('settings.workspaceUserScope'), overview?.userPaths)}
        {renderPaths(t('settings.workspaceProjectScope'), overview?.projectPaths)}
      </div>
      <div className="settings-space-card"><div className="settings-space-card-head"><strong>{t('settings.workspaceStores')}</strong></div><div className="settings-space-list">
        <div className="settings-space-row"><div className="settings-space-row-copy"><span>{t('settings.knowledgePath')}</span><code>{overview?.knowledge.userPath}</code></div></div>
        <div className="settings-space-row"><div className="settings-space-row-copy"><span>{t('settings.memoryPath')}</span><code>{overview?.memory.userPath}</code></div></div>
      </div></div>
    </div>
  </section>;
};
