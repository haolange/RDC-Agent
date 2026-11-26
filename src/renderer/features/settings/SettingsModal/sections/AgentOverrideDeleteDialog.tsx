import { useState } from 'react';
import { Button } from '../../../../ui/Button';
import { InlineError } from '../../../../ui/InlineError';
import { Spinner } from '../../../../ui/Spinner';
import { TaskDialog } from '../../../../ui/TaskDialog';
import { humanizeError } from '../../../../i18n/humanizeError';
import { errorDetail } from '../../../../lib/errorDetail';
import { useI18n } from '../../../../i18n';
import type { AgentOverrideFilePreview } from '@shared/types/agentManifest';

/** A pending deletion of an override file: the preview pins the reviewed content, then the user confirms. */
export interface AgentOverrideDeleteTarget {
  agentId: string;
  sourcePath: string;
  preview?: AgentOverrideFilePreview;
  error?: string;
}

interface AgentOverrideDeleteDialogProps {
  target: AgentOverrideDeleteTarget;
  onConfirm: (preview: AgentOverrideFilePreview) => Promise<void>;
  onClose: () => void;
}

/** Deletes an override that still declares fields moved to Settings → Agents, so the builtin applies. */
export function AgentOverrideDeleteDialog({ target, onConfirm, onClose }: AgentOverrideDeleteDialogProps) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { preview } = target;
  const confirm = async () => {
    if (!preview || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(preview);
    } catch (reason) {
      setError(errorDetail(reason));
      setBusy(false);
    }
  };

  return (
    <TaskDialog
      open
      size="md"
      busy={busy}
      variant="alert"
      title={t('settings.agentOverrideDeleteTitle', { id: target.agentId })}
      description={t('settings.agentOverrideDeleteDescription')}
      closeLabel={t('dialog.close')}
      onClose={onClose}
      dataTestId="settings-agent-override-delete-dialog"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            {t('dialog.cancel')}
          </Button>
          <Button
            variant="danger"
            size="sm"
            loading={busy}
            disabled={!preview}
            onClick={() => void confirm()}
            data-testid="settings-agent-override-delete-confirm"
          >
            {t('settings.agentOverrideDeleteConfirm')}
          </Button>
        </>
      }
    >
      {!preview && !target.error ? <Spinner size="sm" /> : null}
      {target.error ? (
        <InlineError detail={target.error}>{humanizeError(target.error, t, 'app.error.loadFailed')}</InlineError>
      ) : null}
      {preview ? (
        <dl className="settings-agent-file-facts">
          <dt>{t('settings.agentOverrideFile')}</dt>
          <dd>
            <code>{preview.sourcePath}</code>
          </dd>
          <dt>{t('settings.agentOverrideDeleteDeclared')}</dt>
          <dd>{t('settings.agentOverrideDeleteDeclaredHint')}</dd>
        </dl>
      ) : null}
      {error ? <InlineError detail={error}>{humanizeError(error, t, 'app.error.actionFailed')}</InlineError> : null}
    </TaskDialog>
  );
}
