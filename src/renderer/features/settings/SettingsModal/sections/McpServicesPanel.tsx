import React from 'react';
import type { MCPConnectionStatus, MCPServerStatusSummary } from '@shared/types/mcp';
import type { RdxRuntimeOverview, ScopedResourceDocument } from '@shared/types/rdxRuntime';
import { useI18n, type TranslationKey } from '../../../../i18n';
import { Badge, type BadgeTone } from '../../../../ui/Badge';
import { Button } from '../../../../ui/Button';
import { Icon } from '../../../../ui/Icon';
import { InlineError } from '../../../../ui/InlineError';
import { McpTrustBadge, McpTrustPanel, mcpTrustState } from './McpTrustPanel';
import { RuntimeScopePanel } from './RuntimeScopePanel';
import { formFromContent } from './scopedResourceForm';
import { useMcpStatus } from './useMcpStatus';

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

const STATUS_TONE: Record<BadgeKind, BadgeTone | null> = {
  connected: 'success',
  error: 'error',
  loading: 'warning',
  disconnected: null,
};

function ConnectionBadge({ server }: { server: MCPServerStatusSummary | undefined }) {
  const { t } = useI18n();
  const kind = server ? STATUS_BADGE[server.connectionStatus] ?? 'disconnected' : 'disconnected';
  const tone = STATUS_TONE[kind];
  const label = t(STATUS_LABEL_KEY[kind]);
  return tone
    ? <Badge tone={tone} data-testid="settings-mcp-connection-badge" data-status={kind}>{label}</Badge>
    : <span className="settings-mcp-status-neutral" data-testid="settings-mcp-connection-badge" data-status={kind}>{label}</span>;
}

/**
 * Tools → MCP services: the scoped MCP resource list joined with the live connection
 * summary and, per selected server, a read-only detail with its trust state.
 * Connection failure and trust are independent facts and stay in separate badges.
 */
export const McpServicesPanel: React.FC<{
  overview: RdxRuntimeOverview | null;
  scope: 'user' | 'project';
  onScopeChange: (scope: 'user' | 'project') => void;
  onChanged: (overview: RdxRuntimeOverview) => void;
}> = ({ overview, scope, onScopeChange, onChanged }) => {
  const { t } = useI18n();
  const status = useMcpStatus();

  const statusFor = (resource: ScopedResourceDocument) => status.byId.get(resource.id);
  const overviewFor = (resource: ScopedResourceDocument) =>
    overview?.mcpServers.find((server) => server.id === resource.id && server.scope === resource.scope);

  const renderDetail = ({ resource, edit }: { resource: ScopedResourceDocument; edit: () => void }) => {
    const form = formFromContent('mcp', resource.id, resource.content);
    const live = statusFor(resource);
    const server = overviewFor(resource);
    const trust = server ? mcpTrustState(server) : null;
    return (
      <details key={resource.id} className="settings-mcp-detail" data-testid="settings-mcp-detail">
        <summary className="settings-local-tool-summary">
          <span className="settings-runtime-detail-title">
            <strong>{form.name || resource.id}</strong>
            <span className="settings-runtime-detail-badges">
              <ConnectionBadge server={live} />
              {trust ? <McpTrustBadge state={trust} /> : null}
            </span>
          </span>
          <Icon name="chevron-down" size={14} className="settings-local-tool-caret" />
        </summary>
        <div className="settings-runtime-detail">
          <div className="settings-runtime-actions">
            <Button variant="secondary" size="sm" onClick={edit} data-testid="settings-mcp-detail-edit">
              <Icon name="edit" size={14} />
              {t('settings.edit')}
            </Button>
          </div>
        <dl className="settings-runtime-detail-grid">
          <div><dt>{t('settings.resourceFieldId')}</dt><dd><code>{resource.id}</code></dd></div>
          <div><dt>{t('settings.resourceFieldTransport')}</dt><dd>{form.transport}</dd></div>
          {form.url ? <div><dt>{t('settings.resourceFieldUrl')}</dt><dd><code>{form.url}</code></dd></div> : null}
          {form.command ? <div><dt>{t('settings.resourceFieldCommand')}</dt><dd><code>{form.command}</code></dd></div> : null}
          {form.argsText.trim() && form.argsText.trim() !== '[]' ? (
            <div><dt>{t('settings.resourceFieldArgs')}</dt><dd><code>{form.argsText.replace(/\s+/g, ' ')}</code></dd></div>
          ) : null}
          <div><dt>{t('settings.resourceFieldEnabledDefault')}</dt><dd>{form.enabled ? t('settings.enabled') : t('settings.disabled')}</dd></div>
          <div><dt>{t('settings.mcpStatusTitle')}</dt><dd>{live ? t('settings.mcpStatusToolCount', { count: live.toolCount }) : t('settings.mcpStatusDisconnected')}</dd></div>
          <div><dt>{t('settings.resourceScope')}</dt><dd>{resource.scope === 'project' ? t('settings.scopeProject') : t('settings.scopeUser')}</dd></div>
          <div><dt>{t('settings.scopeResourceLocation')}</dt><dd><code>{resource.sourcePath}</code></dd></div>
        </dl>
        {live?.lastError ? <InlineError>{live.lastError}</InlineError> : null}
        {server && overview ? <McpTrustPanel overview={overview} server={server} onChanged={onChanged} /> : null}
        </div>
      </details>
    );
  };

  return (
    <>
      <RuntimeScopePanel
        overview={overview}
        scope={scope}
        onScopeChange={onScopeChange}
        kinds={['mcp']}
        onChanged={onChanged}
        editorPresentation="dialog"
        toolbarExtra={(
          <Button
            variant="ghost"
            disabled={status.loading}
            onClick={() => void status.refresh()}
            data-testid="settings-mcp-status-refresh"
          >
            <Icon name="refresh" size={14} />
            {status.loading ? t('settings.mcpStatusRefreshing') : t('settings.mcpStatusRefresh')}
          </Button>
        )}
        renderRowTrailing={(resource) => {
          const live = statusFor(resource);
          return (
            <span className="settings-mcp-row-trailing">
              {live ? <small>{t('settings.mcpStatusToolCount', { count: live.toolCount })}</small> : null}
              <ConnectionBadge server={live} />
            </span>
          );
        }}
        renderDetail={renderDetail}
      />
      {status.error ? <InlineError>{status.error}</InlineError> : null}
      {status.unavailable ? <p className="settings-help-text">{t('settings.mcpStatusUnavailable')}</p> : null}
    </>
  );
};
