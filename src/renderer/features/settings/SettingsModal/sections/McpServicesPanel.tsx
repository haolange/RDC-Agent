import React, { useState } from 'react';
import { useI18n, type TranslationKey } from '../../../../i18n';
import { errorDetail } from '../../../../lib/errorDetail';
import { useUiLabels } from '../../../../lib/useUiLabels';
import { Button } from '../../../../ui/Button';
import { Icon } from '../../../../ui/Icon';
import { InlineError } from '../../../../ui/InlineError';
import { CopyDiagnosticsMenu } from '../../../../patterns/CopyDiagnostics';
import { McpResourceList } from './McpResourceList';
import { McpTrustPanel } from './McpTrustPanel';
import { mcpTransportLabel } from './resourceLabels';
import { RuntimeScopePanel } from './RuntimeScopePanel';
import { saveScopedResource } from './runtimeScopeMutations';
import { formFromContent } from './scopedResourceForm';
import { useMcpStatus } from './useMcpStatus';
import type { DiagnosticFact } from '../../../../patterns/CopyDiagnostics';
import type { MCPConnectionStatus, MCPServerStatusSummary } from '@shared/types/mcp';
import type { RdcRuntimeOverview, ScopedResourceDocument } from '@shared/types/rdcRuntime';

const CONNECTION_LABEL_KEY: Record<MCPConnectionStatus, TranslationKey> = {
  connected: 'settings.mcpStatusConnected',
  error: 'settings.mcpStatusError',
  connecting: 'settings.mcpStatusConnecting',
  disconnected: 'settings.mcpStatusDisconnected',
  unknown: 'settings.mcpStatusUnknown',
};

/** A status dot and one word; the reason for an error is in the server's detail. */
function ConnectionStatus({ server }: { server: MCPServerStatusSummary | undefined }) {
  const { t } = useI18n();
  const kind = server?.connectionStatus;
  if (!kind) return null;
  return (
    <span className="settings-mcp-status" data-testid="settings-mcp-connection-badge" data-status={kind}>
      {t(CONNECTION_LABEL_KEY[kind])}
    </span>
  );
}

/**
 * Tools → MCP services: the scoped MCP servers as name · status · switch, joined with the live connection summary.
 * The selected server shows its tools, its trust and, under 诊断, how it is reached and where it is defined.
 * Connection failure and trust are independent facts and stay separate.
 */
export const McpServicesPanel: React.FC<{
  overview: RdcRuntimeOverview | null;
  scope: 'user' | 'project';
  onScopeChange: (scope: 'user' | 'project') => void;
  onChanged: (overview: RdcRuntimeOverview) => void;
}> = ({ overview, scope, onScopeChange, onChanged }) => {
  const { t } = useI18n();
  const labels = useUiLabels();
  const status = useMcpStatus();
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const statusFor = (resource: ScopedResourceDocument) => status.byId.get(resource.id);
  const overviewFor = (resource: ScopedResourceDocument) =>
    overview?.mcpServers.find((server) => server.id === resource.id && server.scope === resource.scope);

  const toggle = async (resource: ScopedResourceDocument, enabled: boolean) => {
    setTogglingId(resource.id);
    setToggleError(null);
    try {
      const outcome = await saveScopedResource({
        kind: 'mcp',
        scope: resource.scope,
        form: { ...formFromContent('mcp', resource.id, resource.content), enabled },
        creating: false,
        existingIds: [],
        ...(overview?.projectRoot ? { projectRoot: overview.projectRoot } : {}),
      });
      if (!outcome.ok) {
        setToggleError(outcome.message ?? '');
        return;
      }
      onChanged(outcome.overview);
      void status.refresh();
    } catch (failure) {
      setToggleError(errorDetail(failure));
    } finally {
      setTogglingId(null);
    }
  };

  const renderDetail = ({ resource, edit }: { resource: ScopedResourceDocument; edit: () => void }) => {
    const form = formFromContent('mcp', resource.id, resource.content);
    const live = statusFor(resource);
    const server = overviewFor(resource);
    const args = form.argsText.trim() && form.argsText.trim() !== '[]' ? form.argsText.replace(/\s+/g, ' ') : '';
    const diagnostics: DiagnosticFact[] = [
      { label: t('settings.resourceFieldId'), value: resource.id },
      { label: t('settings.resourceFieldTransport'), value: mcpTransportLabel(form.transport, t) },
      ...(form.url ? [{ label: t('settings.resourceFieldUrl'), value: form.url }] : []),
      ...(form.command ? [{ label: t('settings.resourceFieldCommand'), value: form.command }] : []),
      ...(args ? [{ label: t('settings.resourceFieldArgs'), value: args }] : []),
      { label: t('settings.resourceScope'), value: resource.scope === 'project' ? t('settings.scopeProject') : t('settings.scopeUser') },
      { label: t('settings.scopeResourceLocation'), value: resource.sourcePath },
      ...(server?.descriptorHash ? [{ label: t('settings.mcpDescriptorHash'), value: server.descriptorHash }] : []),
    ];
    return (
      <div key={resource.id} className="settings-runtime-detail settings-mcp-detail" data-testid="settings-mcp-detail">
        <header className="settings-runtime-detail-head">
          <div className="settings-runtime-detail-title">
            <strong>{form.name || resource.id}</strong>
          </div>
          <div className="settings-runtime-actions">
            <Button variant="secondary" size="sm" onClick={edit} data-testid="settings-mcp-detail-edit">
              <Icon name="edit" size={14} />
              {t('settings.edit')}
            </Button>
            <CopyDiagnosticsMenu testId="settings-mcp-diagnostics" facts={diagnostics} />
          </div>
        </header>
        {live?.connectionStatus === 'connected' ? (
          <dl className="settings-runtime-detail-grid">
            <div><dt>{t('settings.mcpToolsLabel')}</dt><dd>{t('settings.mcpStatusToolCount', { count: live.toolCount })}</dd></div>
          </dl>
        ) : null}
        {live?.lastError ? <InlineError detail={live.lastError}>{t('settings.mcpConnectFailed')}</InlineError> : null}
        {server && overview ? <McpTrustPanel overview={overview} server={server} onChanged={onChanged} /> : null}
      </div>
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
        renderList={({ resources, selectedId, select }) => (
          <McpResourceList
            resources={resources}
            selectedId={selectedId}
            busyId={togglingId}
            onSelect={select}
            onToggle={(resource, enabled) => void toggle(resource, enabled)}
            renderStatus={(resource) => <ConnectionStatus server={statusFor(resource)} />}
          />
        )}
        renderDetail={renderDetail}
      />
      {toggleError !== null ? <InlineError detail={toggleError || undefined}>{t('settings.mcpToggleFailed')}</InlineError> : null}
      {status.error !== null || status.unavailable ? (
        <InlineError detail={status.error ?? undefined} onRetry={() => void status.refresh()} retryLabel={labels.retry}
          retryDisabled={status.loading}>
          {t('settings.mcpStatusUnavailable')}
        </InlineError>
      ) : null}
    </>
  );
};
