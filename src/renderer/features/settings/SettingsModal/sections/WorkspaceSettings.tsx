import { getElectronApi } from '../../../../platform/getElectronApi';
import React from 'react';
import type { AppSettings } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';

type Translate = ReturnType<typeof useI18n>['t'];

interface DerivedPathEntry {
  label: string;
  value: string;
}

interface WorkspaceSettingsProps {
  settings: AppSettings;
  workspaceDraft: string;
  derivedPathEntries: DerivedPathEntry[];
  onWorkspacePick: () => void | Promise<void>;
  onWorkspaceSave: () => void | Promise<void>;
  onWorkspaceReset: () => void | Promise<void>;
  t: Translate;
}

export const WorkspaceSettings: React.FC<WorkspaceSettingsProps> = ({
  settings,
  workspaceDraft,
  derivedPathEntries,
  onWorkspacePick,
  onWorkspaceSave,
  onWorkspaceReset,
  t,
}) => {
  const rootPath = workspaceDraft || settings.paths.defaultWorkspaceRoot;
  const userSpaceEntries = derivedPathEntries.filter((_, index) => [0, 4, 5, 6, 7].includes(index));
  const projectSpaceEntries = derivedPathEntries.filter((_, index) => [2, 3].includes(index));

  const renderSpaceCard = (title: string, entries: DerivedPathEntry[]) => (
    <div className="settings-space-card">
      <div className="settings-space-card-head">
        <strong>{title}</strong>
      </div>
      <div className="settings-space-list">
        {entries.map((entry) => (
          <div key={entry.label} className="settings-space-row">
            <div className="settings-space-row-copy">
              <span>{entry.label}</span>
              <code title={entry.value}>{entry.value}</code>
            </div>
            <div className="settings-space-row-actions">
              <button type="button" className="button button-secondary" onClick={() => void getElectronApi()?.appShell.openPath(entry.value)}>
                {t('settings.reveal')}
              </button>
              <button type="button" className="button button-secondary" onClick={() => void getElectronApi()?.appShell.copyText(entry.value)}>
                {t('settings.copy')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <section className="settings-page settings-page-workspace">
      <div className="settings-workspace-page scrollbar-thin" data-testid="settings-workspace-body">
        <div className="settings-workspace-hero settings-workspace-root-card">
          <div className="settings-workspace-hero-copy">
            <div className="settings-field-label">{t('settings.workspaceRoot')}</div>
            <div className="settings-help-text">{t('settings.workspaceRootHint')}</div>
          </div>
          <div className="settings-path-value settings-workspace-root-value">{rootPath}</div>
          <div className="settings-path-actions settings-workspace-root-actions">
            <button type="button" className="button button-secondary" onClick={() => void onWorkspacePick()}>
              {t('settings.chooseDirectory')}
            </button>
            <button type="button" className="button button-secondary" onClick={() => void getElectronApi()?.appShell.openPath(rootPath)}>
              {t('settings.reveal')}
            </button>
            <button type="button" className="button button-secondary" onClick={() => void getElectronApi()?.appShell.copyText(rootPath)}>
              {t('settings.copy')}
            </button>
          </div>
        </div>

        <div className="settings-space-stack">
          {renderSpaceCard(t('settings.userSpaceTitle'), userSpaceEntries)}
          {renderSpaceCard(t('settings.projectSpaceTitle'), projectSpaceEntries)}
        </div>

        {settings.configuration.diagnostics.length > 0 && (
          <div className="settings-path-card settings-workspace-note-card">
            <div className="settings-field-label">{t('settings.diagnostics')}</div>
            <div className="settings-workspace-note-list">
              {settings.configuration.diagnostics.map((diagnostic, index) => (
                <div key={`${diagnostic.message}-${index}`} className="settings-workspace-note-item">
                  {diagnostic.message}
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="settings-actions settings-workspace-footer-actions">
          <button type="button" className="button button-secondary" onClick={() => void onWorkspaceReset()}>
            {t('settings.resetWorkspace')}
          </button>
          <button type="button" className="button button-primary" onClick={() => void onWorkspaceSave()}>
            {t('settings.save')}
          </button>
        </div>
      </div>
    </section>
  );
};
