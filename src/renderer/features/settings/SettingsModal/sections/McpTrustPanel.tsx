import React, { useState } from 'react';
import type { RdxRuntimeOverview } from '@shared/types/rdxRuntime';
import { useI18n } from '../../../../i18n';
import {
  BrowserQaDesktopOnlyNotice,
  isBrowserQaDesktopOnlySurface,
} from '../../../../platform/BrowserQaDesktopOnlyNotice';

export const McpTrustPanel: React.FC<{
  overview: RdxRuntimeOverview | null;
  onChanged: (overview: RdxRuntimeOverview) => void;
}> = ({ overview, onChanged }) => {
  const { t } = useI18n();
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');
  const desktopOnly = isBrowserQaDesktopOnlySurface();
  const projectServers = overview?.mcpServers.filter((server) => (
    server.scope === 'project' || server.executableOverrideRejected || server.needsRetrust
  )) ?? [];

  if (!overview?.projectRoot || projectServers.length === 0) {
    return null;
  }

  const run = async (descriptorId: string, action: 'trust' | 'revoke') => {
    if (!overview.projectRoot || desktopOnly) return;
    setBusyId(descriptorId);
    setMessage('');
    try {
      onChanged(action === 'trust'
        ? await window.electronAPI.rdxRuntime.trustMcp(overview.projectRoot, descriptorId)
        : await window.electronAPI.rdxRuntime.revokeMcp(overview.projectRoot, descriptorId));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="settings-runtime-list" data-testid="settings-mcp-trust-panel">
      <h3 className="settings-mcp-status-title">{t('settings.mcpTrustTitle')}</h3>
      <BrowserQaDesktopOnlyNotice kind="mcpTrust" testId="browser-qa-mcp-trust-desktop-only" />
      <p>{t('settings.mcpTrustHint')}</p>
      {projectServers.map((server) => (
        <article className="settings-runtime-card" key={server.id}>
          <div>
            <strong>{server.name || server.id}</strong>
            <p>
              {server.transport}
              {server.command ? ` · ${server.command}` : ''}
              {' · '}
              {server.executableOverrideRejected
                ? t('settings.mcpOverrideRejected')
                : server.trusted
                  ? t('settings.mcpTrusted')
                  : t('settings.mcpUntrusted')}
            </p>
            {server.sourcePath ? <code>{server.sourcePath}</code> : null}
            {server.blockedReason ? <p>{server.blockedReason}</p> : null}
          </div>
          <div className="settings-runtime-actions">
            {!server.executableOverrideRejected && server.scope === 'project' && (server.trusted
              ? (
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={desktopOnly || busyId === server.id}
                  onClick={() => void run(server.id, 'revoke')}
                >
                  {t('settings.mcpRevoke')}
                </button>
              )
              : (
                <button
                  type="button"
                  className="button button-primary"
                  disabled={desktopOnly || busyId === server.id}
                  onClick={() => void run(server.id, 'trust')}
                >
                  {t('settings.mcpTrust')}
                </button>
              ))}
          </div>
        </article>
      ))}
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
};
