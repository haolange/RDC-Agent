import React, { useCallback, useEffect, useState } from 'react';
import type { MCPConnectionStatus, MCPServerStatusSummary } from '@shared/types/mcp';
import { useI18n, type TranslationKey } from '../../../../i18n';
import { getElectronApi } from '../../../../platform/getElectronApi';

type BadgeKind = 'connected' | 'error' | 'loading' | 'disconnected';

const STATUS_BADGE: Record<MCPConnectionStatus, BadgeKind> = {
  connected: 'connected',
  error: 'error',
  connecting: 'loading',
  disconnected: 'disconnected',
  unknown: 'disconnected',
};

const STATUS_LABEL_KEY: Record<BadgeKind, TranslationKey> = {
  connected: 'settings.mcpStatusConnected',
  error: 'settings.mcpStatusError',
  loading: 'settings.mcpStatusLoading',
  disconnected: 'settings.mcpStatusDisconnected',
};

export const McpStatusDashboard: React.FC = () => {
  const { t } = useI18n();
  const [servers, setServers] = useState<MCPServerStatusSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    const api = getElectronApi();
    if (!api?.mcp?.getStatusSummary) {
      setServers([]);
      setError(t('settings.mcpStatusUnavailable'));
      return;
    }

    setLoading(true);
    try {
      const next = await api.mcp.getStatusSummary();
      setServers(Array.isArray(next) ? next : []);
      setError(null);
    } catch (failure) {
      setServers([]);
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section
      className="settings-mcp-status-dashboard"
      data-testid="settings-mcp-status-dashboard"
    >
      <div className="settings-mcp-status-header">
        <div className="settings-mcp-status-heading">
          <h3 className="settings-mcp-status-title">{t('settings.mcpStatusTitle')}</h3>
        </div>
        <button
          type="button"
          className="button button-secondary"
          data-testid="settings-mcp-status-refresh"
          onClick={() => void refresh()}
          disabled={loading}
        >
          {loading ? t('settings.mcpStatusRefreshing') : t('settings.mcpStatusRefresh')}
        </button>
      </div>

      {error ? (
        <div className="settings-empty settings-empty-dashed" role="alert">{error}</div>
      ) : servers.length === 0 ? (
        <div className="settings-empty settings-empty-dashed" role="status">
          {t('settings.mcpStatusEmpty')}
        </div>
      ) : (
        <ul className="settings-mcp-status-list">
          {servers.map((server) => {
            const badge = STATUS_BADGE[server.connectionStatus] ?? 'disconnected';
            return (
              <li key={server.id} className="settings-mcp-status-row" data-testid="settings-mcp-status-row">
                <div className="settings-mcp-status-row-main">
                  <span className="settings-mcp-status-name" title={server.id}>{server.name}</span>
                  <span className={`settings-mcp-status-badge is-${badge}`}>
                    {t(STATUS_LABEL_KEY[badge])}
                  </span>
                </div>
                <div className="settings-mcp-status-row-meta">
                  <span className="settings-mcp-status-tools">
                    {t('settings.mcpStatusToolCount', { count: server.toolCount })}
                  </span>
                  {server.lastError ? (
                    <span className="settings-mcp-status-error" title={server.lastError}>
                      {server.lastError}
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

export default McpStatusDashboard;
