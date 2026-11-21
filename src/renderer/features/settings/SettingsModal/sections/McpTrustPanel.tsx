import React, { useState } from 'react';
import { useI18n } from '../../../../i18n';
import { Badge } from '../../../../ui/Badge';
import { Button } from '../../../../ui/Button';
import { InlineError } from '../../../../ui/InlineError';
import { errorDetail } from '../../../../lib/errorDetail';
import { revokeMcp, trustMcp } from './mcpTrustActions';
import { ResourceTrustBlock } from './ResourceTrustBlock';
import type { RdcRuntimeOverview } from '@shared/types/rdcRuntime';

type McpServerOverview = RdcRuntimeOverview['mcpServers'][number];

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
  overview: RdcRuntimeOverview;
  server: McpServerOverview;
  onChanged: (overview: RdcRuntimeOverview) => void;
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
      setMessage(errorDetail(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ResourceTrustBlock
      testId="settings-mcp-trust-panel"
      state={state}
      title={t('settings.mcpTrustTitle')}
      hint={t('settings.mcpTrustHint')}
      badge={<McpTrustBadge state={state} />}
      changed={state === 'needs-retrust' ? { message: t('settings.mcpTrustChanged'), testId: 'settings-mcp-trust-change' } : undefined}
      actions={state !== 'override-rejected' ? (
        <>
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
        </>
      ) : undefined}
    >
      {state === 'override-rejected' && server.blockedReason
        ? <InlineError detail={server.blockedReason}>{t('settings.mcpOverrideRejectedMessage')}</InlineError> : null}
      {message ? <InlineError detail={message}>{t('app.error.actionFailed')}</InlineError> : null}
    </ResourceTrustBlock>
  );
};
