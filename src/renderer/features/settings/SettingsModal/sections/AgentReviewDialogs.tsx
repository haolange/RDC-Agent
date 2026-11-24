import { AgentBuiltinDiffDialog } from './AgentBuiltinDiffDialog';
import { AgentModelMigrationDialog } from './AgentModelMigrationDialog';
import { ProjectAgentTrustDialog } from './ProjectAgentTrustDialog';
import type { useAgentModelControls } from './useAgentModelControls';
import type { AppSettings } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';

export function AgentReviewDialogs({ models, options, onRestore, t }: {
  models: ReturnType<typeof useAgentModelControls>;
  options: AppSettings['agents']['modelOptions'];
  onRestore: () => void;
  t: ReturnType<typeof useI18n>['t'];
}) {
  return (
    <>
      {models.builtinDiff ? (
        <AgentBuiltinDiffDialog
          state={models.builtinDiff}
          onClose={models.closeBuiltinDiff}
          onRestore={() => { models.closeBuiltinDiff(); onRestore(); }}
          t={t}
        />
      ) : null}
      {models.overrideAction ? (
        <AgentModelMigrationDialog
          target={models.overrideAction}
          options={options}
          onConfirm={models.confirmOverrideAction}
          onClose={models.closeOverrideAction}
          t={t}
        />
      ) : null}
      {models.trustReview ? (
        <ProjectAgentTrustDialog
          review={models.trustReview}
          onConfirm={models.confirmTrust}
          onClose={models.closeTrustReview}
          t={t}
        />
      ) : null}
    </>
  );
}
