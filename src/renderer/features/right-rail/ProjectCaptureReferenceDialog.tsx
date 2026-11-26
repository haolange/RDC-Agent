import { useState } from 'react';
import { TaskDialog } from '../../ui/TaskDialog';
import { Input } from '../../ui/Input';
import { Button } from '../../ui/Button';
import { InlineError } from '../../ui/InlineError';
import { useI18n } from '../../i18n';
import { errorDetail } from '../../lib/errorDetail';
import { isImeComposing } from '../../lib/ime';
import { referenceProjectInput } from './projectCaptureActions';
import type { ProjectInputRecord } from '@shared/types/session';

export function ProjectCaptureReferenceDialog({
  projectId,
  onClose,
  onRegistered,
}: {
  projectId: string;
  onClose: () => void;
  onRegistered: (projectId: string, inputs: ProjectInputRecord[]) => void;
}) {
  const { t } = useI18n();
  const [filePath, setFilePath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (busy || !filePath.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await referenceProjectInput(projectId, filePath.trim());
      if (!result.success) throw new Error(result.error ?? t('projectCapture.referenceFailed'));
      onRegistered(projectId, result.inputs);
      onClose();
    } catch (reason) {
      setError(errorDetail(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <TaskDialog
      open
      title={t('projectCapture.reference')}
      description={t('projectCapture.referenceHint')}
      onClose={onClose}
      closeLabel={t('projectCapture.cancel')}
      busy={busy}
      size="sm"
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {t('projectCapture.cancel')}
          </Button>
          <Button disabled={busy || !filePath.trim()} onClick={() => void submit()}>
            {t('projectCapture.registerReference')}
          </Button>
        </>
      }
    >
      <Input
        aria-label={t('projectCapture.referencePath')}
        value={filePath}
        disabled={busy}
        onChange={(event) => setFilePath(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !isImeComposing(event)) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      {error ? <InlineError detail={error}>{t('app.error.actionFailed')}</InlineError> : null}
    </TaskDialog>
  );
}
