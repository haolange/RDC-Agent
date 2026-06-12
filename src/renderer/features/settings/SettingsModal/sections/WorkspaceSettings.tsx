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
}) => (
  <section className="settings-page settings-page-workspace">
    <div className="settings-workspace-page scrollbar-thin" data-testid="settings-workspace-body">
      <div className="settings-workspace-hero">
        <div className="settings-workspace-hero-copy">
          <div className="settings-field-label">{t('settings.workspaceRoot')}</div>
          <div className="settings-help-text">{t('settings.workspaceRootHint')}</div>
        </div>
        <div className="settings-path-value settings-workspace-root-value">{workspaceDraft || settings.paths.defaultWorkspaceRoot}</div>
        <div className="settings-path-actions settings-workspace-root-actions">
          <button type="button" className="button button-secondary" onClick={() => void onWorkspacePick()}>
            {t('settings.chooseDirectory')}
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => void getElectronApi()?.appShell.openPath(workspaceDraft || settings.workspace.rootPath)}
          >
            {t('settings.reveal')}
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => void getElectronApi()?.appShell.copyText(workspaceDraft || settings.workspace.rootPath)}
          >
            {t('settings.copy')}
          </button>
        </div>
      </div>

      <div className="settings-path-card settings-derived-paths-card">
        <div className="settings-derived-paths-header">
          <div className="settings-field-label">{t('settings.derivedPathsTitle')}</div>
          <div className="settings-help-text">{t('settings.derivedPathsHint')}</div>
        </div>
        <div className="settings-derived-path-list">
          {derivedPathEntries.map((entry) => (
            <div key={entry.label} className="settings-derived-path-row">
              <div className="settings-derived-path-copy">
                <div className="settings-derived-path-label">{entry.label}</div>
                <div className="settings-derived-path-value">{entry.value}</div>
              </div>
              <div className="settings-derived-path-actions">
                <button
                  type="button"
                  className="button button-secondary settings-derived-path-button"
                  onClick={() => void getElectronApi()?.appShell.openPath(entry.value)}
                >
                  {t('settings.reveal')}
                </button>
                <button
                  type="button"
                  className="button button-secondary settings-derived-path-button"
                  onClick={() => void getElectronApi()?.appShell.copyText(entry.value)}
                >
                  {t('settings.copy')}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {settings.configuration.diagnostics.length > 0 && (
        <div className="settings-workspace-meta-grid">
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
