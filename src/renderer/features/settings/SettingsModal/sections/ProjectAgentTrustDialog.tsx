import { useState } from 'react';
import { Button } from '../../../../ui/Button';
import { InlineError } from '../../../../ui/InlineError';
import { Spinner } from '../../../../ui/Spinner';
import { TaskDialog } from '../../../../ui/TaskDialog';
import type { useI18n } from '../../../../i18n';
import type { ProjectAgentTrustPreview } from '@shared/types/agentManifest';

type Translate = ReturnType<typeof useI18n>['t'];

/** A project Agent profile under review: the file loads first, then the user trusts what they read. */
export interface ProjectAgentTrustReview {
  agentId: string;
  sourcePath: string;
  preview?: ProjectAgentTrustPreview;
  error?: string;
}

/**
 * The whole profile is shown before trusting it, because its instructions and tool list run in every
 * turn of this project. Trust covers these bytes only; a later edit outside Settings asks again.
 */
export function ProjectAgentTrustDialog({ review, onConfirm, onClose, t }: {
  review: ProjectAgentTrustReview;
  onConfirm: (preview: ProjectAgentTrustPreview) => Promise<void>;
  onClose: () => void;
  t: Translate;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { preview } = review;
  const confirm = async () => {
    if (!preview || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(preview);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('settings.agentTrustFailed'));
      setBusy(false);
    }
  };

  return (
    <TaskDialog
      open
      size="lg"
      busy={busy}
      className="settings-agent-trust-dialog"
      title={t('settings.agentTrustTitle', { id: review.agentId })}
      description={t('settings.agentTrustDescription')}
      closeLabel={t('dialog.close')}
      onClose={onClose}
      dataTestId="settings-agent-trust-dialog"
      footer={<>
        <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>{t('dialog.cancel')}</Button>
        <Button variant="primary" size="sm" loading={busy} disabled={!preview}
          onClick={() => void confirm()} data-testid="settings-agent-trust-confirm">
          {t('settings.agentTrustConfirm')}
        </Button>
      </>}
    >
      {!preview && !review.error ? <Spinner size="sm" /> : null}
      {review.error ? <InlineError>{review.error}</InlineError> : null}
      {preview ? (
        <>
          <dl className="settings-agent-migration-facts">
            <dt>{t('settings.agentModelMigrationFile')}</dt>
            <dd><code>{preview.sourcePath}</code></dd>
          </dl>
          <pre className="settings-agent-trust-content scrollbar-thin" tabIndex={0}
            aria-label={t('settings.agentTrustContent')} data-testid="settings-agent-trust-content">
            {preview.content}
          </pre>
        </>
      ) : null}
      {error ? <InlineError>{error}</InlineError> : null}
    </TaskDialog>
  );
}
