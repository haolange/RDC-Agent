import React from 'react';
import type { RdxRuntimeOverview } from '@shared/types/rdxRuntime';
import type { useI18n } from '../../../../i18n';
import { getElectronApi } from '../../../../platform/getElectronApi';

type Translate = ReturnType<typeof useI18n>['t'];

export const WorkspaceSettings: React.FC<{ overview: RdxRuntimeOverview | null; loading: boolean; error: string; t: Translate }> = ({ overview, loading, error, t }) => {
  const renderPaths = (title: string, paths?: Record<string, string>) => <div className="settings-space-card">
    <div className="settings-space-card-head"><strong>{title}</strong></div>
    <div className="settings-space-list">
      {paths ? Object.entries(paths).filter(([key]) => !['projectRoot', 'userRdxRoot'].includes(key)).map(([key, value]) => <div className="settings-space-row" key={key}>
        <div className="settings-space-row-copy"><span>{key}</span><code title={value}>{value}</code></div>
        <div className="settings-space-row-actions">
          <button type="button" className="button button-secondary" onClick={() => void getElectronApi()?.appShell.openPath(value)}>{t('settings.reveal')}</button>
          <button type="button" className="button button-secondary" onClick={() => void getElectronApi()?.appShell.copyText(value)}>{t('settings.copy')}</button>
        </div>
      </div>) : <div className="settings-runtime-empty">当前未打开 Project；Project Scope 会在选择 Project 后自动建立。</div>}
    </div>
  </div>;

  return <section className="settings-page settings-page-workspace">
    <div className="settings-workspace-page scrollbar-thin" data-testid="settings-workspace-body">
      <div className="settings-workspace-hero settings-workspace-root-card">
        <div className="settings-workspace-hero-copy"><div className="settings-field-label">Canonical RDX Runtime</div><div className="settings-help-text">路径由运行时固定管理，不再提供 Workspace Root 配置。</div></div>
        <div className="settings-path-value settings-workspace-root-value">{overview?.userRoot ?? (loading ? 'Loading…' : 'Unavailable')}</div>
        <div className="settings-path-actions settings-workspace-root-actions"><button type="button" className="button button-secondary" onClick={() => overview?.userRoot && void getElectronApi()?.appShell.openPath(overview.userRoot)}>{t('settings.reveal')}</button></div>
      </div>
      {error && <div className="settings-path-card settings-workspace-note-card"><div className="settings-workspace-note-list"><div className="settings-workspace-note-item">{error}</div></div></div>}
      <div className="settings-space-stack">
        {renderPaths('User Scope · ~/.rdx', overview?.userPaths)}
        {renderPaths('Project Scope · <project>/.rdx', overview?.projectPaths)}
      </div>
      <div className="settings-space-card"><div className="settings-space-card-head"><strong>Top-level stores</strong></div><div className="settings-space-list">
        <div className="settings-space-row"><div className="settings-space-row-copy"><span>Knowledge</span><code>{overview?.knowledge.userPath}</code></div></div>
        <div className="settings-space-row"><div className="settings-space-row-copy"><span>Memory（显式工具）</span><code>{overview?.memory.userPath}</code></div></div>
      </div></div>
      <div className="settings-actions settings-workspace-footer-actions"><span className="settings-help-text">Canonical paths are managed by RDX Runtime.</span></div>
    </div>
  </section>;
};
