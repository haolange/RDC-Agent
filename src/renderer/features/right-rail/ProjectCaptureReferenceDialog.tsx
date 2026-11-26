import { useState } from 'react';
import { TaskDialog } from '../../ui/TaskDialog';
import { Input } from '../../ui/Input';
import { Button } from '../../ui/Button';
import { FailureAlert } from '../../patterns/FailureAlert';
import { useI18n } from '../../i18n';
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
  const [failure, setFailure] = useState<{ reason: unknown } | null>(null);
  const submit = async () => {
    if (busy || !filePath.trim()) return;
    setBusy(true);
    setFailure(null);
    try {
      const result = await referenceProjectInput(projectId, filePath.trim());
      onRegistered(projectId, result.inputs);
      onClose();
    } catch (reason) {
      setFailure({ reason });
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
      {failure ? <FailureAlert reason={failure.reason} contextKey="projectCapture.referenceFailed" /> : null}
    </TaskDialog>
  );
}
