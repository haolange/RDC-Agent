import React, { useState } from 'react';
import type { RdxRuntimeOverview } from '@shared/types/rdxRuntime';
import { useI18n } from '../../../../i18n';
import { Badge } from '../../../../ui/Badge';
import { Button } from '../../../../ui/Button';
import { Icon } from '../../../../ui/Icon';
import { InlineError } from '../../../../ui/InlineError';
import { revokeMcp, trustMcp } from './mcpTrustActions';

type McpServerOverview = RdxRuntimeOverview['mcpServers'][number];

export type McpTrustState = 'trusted' | 'needs-retrust' | 'untrusted' | 'override-rejected' | 'user';

export function mcpTrustState(server: McpServerOverview): McpTrustState {
  if (server.executableOverrideRejected) return 'override-rejected';
  if (server.scope !== 'project') return 'user';
  if (server.trusted && server.needsRetrust) return 'needs-retrust';
  return server.trusted ? 'trusted' : 'untrusted';
}

export function McpTrustBadge({ state }: { state: McpTrustState }) {
  const { t } = useI18n();
  if (state === 'user') return null;
  const tone = state === 'trusted' ? 'success' : state === 'override-rejected' ? 'error' : 'warning';
  const label = state === 'trusted'
    ? t('settings.mcpTrusted')
    : state === 'needs-retrust'
      ? t('settings.mcpNeedsRetrust')
      : state === 'override-rejected'
        ? t('settings.mcpOverrideRejected')
        : t('settings.mcpUntrusted');
  return <Badge tone={tone} data-testid="settings-mcp-trust-badge">{label}</Badge>;
}

/**
 * Trust block for one project MCP descriptor. The runtime overview exposes only the
 * current descriptor hash and trust flags, so this shows the real state plus the
 * current summary; there is no previous/current diff to compare against.
 */
export const McpTrustPanel: React.FC<{
  overview: RdxRuntimeOverview;
  server: McpServerOverview;
  onChanged: (overview: RdxRuntimeOverview) => void;
}> = ({ overview, server, onChanged }) => {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const state = mcpTrustState(server);
  const projectRoot = overview.projectRoot;

  if (state === 'user' || !projectRoot) return null;

  const run = async (action: 'trust' | 'revoke') => {
    setBusy(true);
    setMessage('');
    try {
      const next = action === 'trust'
        ? await trustMcp(projectRoot, server.id)
        : await revokeMcp(projectRoot, server.id);
      if (next) onChanged(next);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-trust-block" data-testid="settings-mcp-trust-panel" data-trust-state={state}>
      <header className="settings-trust-block-head">
        <div>
          <div className="settings-section-title">{t('settings.mcpTrustTitle')}</div>
          <p className="settings-help-text">{t('settings.mcpTrustHint')}</p>
        </div>
        <McpTrustBadge state={state} />
      </header>

      <dl className="settings-trust-summary">
        {server.descriptorHash ? (
          <div><dt>{t('settings.mcpDescriptorHash')}</dt><dd><code title={server.descriptorHash}>{server.descriptorHash.slice(0, 12)}</code></dd></div>
        ) : null}
      </dl>

      {state === 'needs-retrust' ? (
        <p className="settings-help-text settings-trust-change" data-testid="settings-mcp-trust-change">
          <Icon name="warning" size={14} />
          {t('settings.mcpTrustChanged')}
        </p>
      ) : null}
      {state === 'override-rejected' && server.blockedReason ? <InlineError>{server.blockedReason}</InlineError> : null}

      <footer className="settings-trust-block-foot">
        <p className="settings-help-text settings-trust-gate">
          <Icon name="info" size={14} />
          {t('settings.mcpTrustGate')}
        </p>
        {state !== 'override-rejected' ? (
          <div className="settings-runtime-actions">
            {state === 'trusted' || state === 'needs-retrust' ? (
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => void run('revoke')}>
                {t('settings.mcpRevoke')}
              </Button>
            ) : null}
            {state !== 'trusted' ? (
              <Button variant="primary" size="sm" disabled={busy} onClick={() => void run('trust')}>
                {t('settings.mcpTrust')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </footer>
      {message ? <InlineError>{message}</InlineError> : null}
    </section>
  );
};
