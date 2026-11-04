import { useEffect, useState } from 'react';
import { formatAgentManifestDiagnostic } from '@shared/utils/agentManifestDiagnostic';
import { useClipboardBridge } from '../../../../hooks/useClipboardBridge';
import { Button } from '../../../../ui/Button';
import { Details } from '../../../../ui/Details';
import { TaskDialog } from '../../../../ui/TaskDialog';
import type { useI18n } from '../../../../i18n';
import type { AgentManifestDiagnostic } from '@shared/types/agentManifest';
import './AgentManifestDiagnostics.css';

type Translate = ReturnType<typeof useI18n>['t'];
export function AgentManifestDiagnostics({ open, onClose, diagnostics, t }: {
  open: boolean; onClose: () => void; diagnostics: AgentManifestDiagnostic[]; t: Translate;
}) {
  const { copyText } = useClipboardBridge();
  const [copying, setCopying] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => { if (open) setCopyStatus('idle'); }, [open]);
  const copy = async (issues: AgentManifestDiagnostic[]) => {
    if (copying || !issues.length) return;
    setCopying(true);
    try { setCopyStatus(await copyText(issues.map(formatAgentManifestDiagnostic).join('\n\n')) ? 'copied' : 'failed'); }
    finally { setCopying(false); }
  };
  return <TaskDialog open={open} onClose={onClose} size="lg" className="agent-diagnostics-dialog"
    title={t('settings.agentDiagnosticsCount', { count: diagnostics.length })}
    description={t('settings.agentDiagnosticsDescription')} closeLabel={t('dialog.close')}
    dataTestId="settings-agent-diagnostics-dialog"
    footer={<>
      <span className="task-dialog-footer-spacer" role="status" aria-live="polite">
        {copyStatus !== 'idle' && t(copyStatus === 'copied' ? 'settings.agentDiagnosticsCopied' : 'settings.agentDiagnosticsCopyFailed')}
      </span>
      <Button variant="secondary" size="sm" disabled={copying || !diagnostics.length} onClick={() => void copy(diagnostics)}>{t('settings.agentDiagnosticsCopyAll')}</Button>
      <Button variant="primary" size="sm" onClick={onClose}>{t('dialog.close')}</Button>
    </>}>
    <div className="agent-diagnostics-content" role="region" aria-label={t('settings.agentDiagnosticsList')} tabIndex={0}>
      {!diagnostics.length && <p>{t('settings.agentDiagnosticsEmpty')}</p>}
      <ul className="agent-diagnostics-list">
        {diagnostics.map(issue => <li key={JSON.stringify([issue.scope, issue.sourcePath, issue.code, issue.message])} className="agent-diagnostics-item">
          <div className="agent-diagnostics-item-header">
            <strong>{issue.agentId}</strong>
            <span className="agent-diagnostics-scope">{t(issue.scope === 'user' ? 'settings.scopeUser' : issue.scope === 'project' ? 'settings.scopeProject' : 'settings.agentDiagnosticsBuiltin')}</span>
            <Button variant="ghost" size="sm" disabled={copying} onClick={() => void copy([issue])}>{t('settings.agentDiagnosticsCopyOne')}</Button>
          </div>
          <p className="agent-diagnostics-path">{issue.sourcePath}</p>
          <p>{t('settings.agentDiagnosticsInvalid')}</p>
          <Details summary={t('settings.agentDiagnosticsDetails')}>
            <code>{issue.code}</code>
            <p>{issue.message}</p>
          </Details>
        </li>)}
      </ul>
    </div>
  </TaskDialog>;
}
