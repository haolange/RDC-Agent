import { useState } from 'react';
import { Button } from '../../../../ui/Button';
import { InlineError } from '../../../../ui/InlineError';
import { Spinner } from '../../../../ui/Spinner';
import { TaskDialog } from '../../../../ui/TaskDialog';
import { humanizeError } from '../../../../i18n/humanizeError';
import { errorDetail } from '../../../../lib/errorDetail';
import { useI18n } from '../../../../i18n';
import { modelOptionLabel } from './agentConfigStatus';
import type { AgentModelBinding } from '@shared/types/settings';
import type { AgentModelMigrationPreview, AgentModelOption } from '@shared/types/agentManifest';

type Translate = ReturnType<typeof useI18n>['t'];

/** A pending action on an override file: the preview loads first, then the user confirms. */
export interface AgentOverrideFileAction {
  action: 'migrate' | 'delete';
  agentId: string;
  sourcePath: string;
  preview?: AgentModelMigrationPreview;
  error?: string;
}

const bindingText = (binding: AgentModelBinding, options: AgentModelOption[], t: Translate): string => {
  const parts = [modelOptionLabel(binding.model, options), binding.reasoningLevel].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : t('settings.agentModelMigrationNone');
};

interface AgentModelMigrationDialogProps {
  target: AgentOverrideFileAction;
  options: AgentModelOption[];
  onConfirm: (preview: AgentModelMigrationPreview) => Promise<void>;
  onClose: () => void;
}

/**
 * Migrate moves the model fields of an inactive override into Settings → Agents and keeps a backup;
 * delete removes the override so the builtin applies. Both show what changes before writing.
 */
export function AgentModelMigrationDialog({ target, options, onConfirm, onClose }: AgentModelMigrationDialogProps) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { preview } = target;
  const migrate = target.action === 'migrate';
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
      variant={migrate ? 'task' : 'alert'}
      title={t(migrate ? 'settings.agentModelMigrationTitle' : 'settings.agentOverrideDeleteTitle', {
        id: target.agentId,
      })}
      description={t(migrate ? 'settings.agentModelMigrationDescription' : 'settings.agentOverrideDeleteDescription')}
      closeLabel={t('dialog.close')}
      onClose={onClose}
      dataTestId="settings-agent-model-migration-dialog"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            {t('dialog.cancel')}
          </Button>
          <Button
            variant={migrate ? 'primary' : 'danger'}
            size="sm"
            loading={busy}
            disabled={!preview}
            onClick={() => void confirm()}
            data-testid="settings-agent-model-migration-confirm"
          >
            {t(migrate ? 'settings.agentModelMigrationConfirm' : 'settings.agentOverrideDeleteConfirm')}
          </Button>
        </>
      }
    >
      {!preview && !target.error ? <Spinner size="sm" /> : null}
      {target.error ? (
        <InlineError detail={target.error}>{humanizeError(target.error, t, 'app.error.loadFailed')}</InlineError>
      ) : null}
      {preview ? (
        <dl className="settings-agent-migration-facts">
          <dt>{t('settings.agentModelMigrationFile')}</dt>
          <dd>
            <code>{preview.sourcePath}</code>
          </dd>
          {migrate ? (
            <>
              <dt>{t('settings.agentModelMigrationSettings')}</dt>
              <dd data-testid="settings-agent-model-migration-binding">
                {bindingText(preview.currentBinding, options, t)} →{' '}
                <strong>{bindingText(preview.binding, options, t)}</strong>
              </dd>
              <dt>{t('settings.agentModelMigrationBackup')}</dt>
              <dd>
                <code>{preview.backupPath}</code>
              </dd>
            </>
          ) : (
            <>
              <dt>{t('settings.agentOverrideDeleteDeclared')}</dt>
              <dd>{t('settings.agentOverrideDeleteDeclaredHint')}</dd>
            </>
          )}
          {preview.droppedHandoffModels.length > 0 ? (
            <>
              <dt>{t('settings.agentModelMigrationHandoffs')}</dt>
              <dd>
                <ul>
                  {preview.droppedHandoffModels.map((entry) => (
                    <li key={`${entry.label}:${entry.agent}:${entry.model}`}>
                      {t('settings.agentModelMigrationHandoffDropped', {
                        label: entry.label,
                        agent: entry.agent,
                        model: entry.model,
                      })}
                    </li>
                  ))}
                </ul>
              </dd>
            </>
          ) : null}
          {preview.ignoredValues.length > 0 ? (
            <>
              <dt>{t('settings.agentModelMigrationIgnored')}</dt>
              <dd>
                {preview.ignoredValues.map((value) => (
                  <code key={value}>{value}</code>
                ))}
              </dd>
            </>
          ) : null}
        </dl>
      ) : null}
      {error ? (
        <InlineError detail={error}>
          {humanizeError(error, t, migrate ? 'settings.agentModelMigrationFailed' : 'app.error.actionFailed')}
        </InlineError>
      ) : null}
    </TaskDialog>
  );
}
