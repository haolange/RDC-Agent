import { ConfirmationDialog } from '../../../../ui/ConfirmationDialog';
import { useI18n } from '../../../../i18n';
import type { AgentManifestDraft } from '@shared/types/agentManifest';

/** Confirms deleting an Agent; for an override of a builtin it restores the builtin instead. */
export function AgentDeleteDialog({ agent, restoresBuiltin, onCancel, onConfirm }: {
  agent: AgentManifestDraft;
  restoresBuiltin: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const name = agent.name || agent.id;
  return (
    <ConfirmationDialog
      title={t(restoresBuiltin ? 'settings.agentRestoreBuiltinTitle' : 'settings.deleteAgentTitle')}
      message={t(restoresBuiltin ? 'settings.agentRestoreBuiltinConfirm' : 'settings.deleteAgentConfirm', { name })}
      details={[
        { label: t('settings.agentName'), value: name },
        { label: t('settings.resourceFieldId'), value: agent.id },
      ]}
      confirmLabel={t(restoresBuiltin ? 'settings.agentRestoreBuiltin' : 'dialog.delete')}
      cancelLabel={t('dialog.cancel')}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
