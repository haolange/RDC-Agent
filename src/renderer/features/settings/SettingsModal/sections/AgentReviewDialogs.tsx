import { AgentBuiltinDiffDialog } from './AgentBuiltinDiffDialog';
import { AgentModelMigrationDialog } from './AgentModelMigrationDialog';
import { ProjectAgentTrustDialog } from './ProjectAgentTrustDialog';
import type { useAgentModelControls } from './useAgentModelControls';
import type { AgentModelOption } from '@shared/types/agentManifest';

export function AgentReviewDialogs({ models, options, onRestore }: {
  models: ReturnType<typeof useAgentModelControls>;
  options: AgentModelOption[];
  onRestore: () => void;
}) {
  return (
    <>
      {models.builtinDiff ? (
        <AgentBuiltinDiffDialog
          state={models.builtinDiff}
          onClose={models.closeBuiltinDiff}
          onRestore={() => { models.closeBuiltinDiff(); onRestore(); }}
        />
      ) : null}
      {models.overrideAction ? (
        <AgentModelMigrationDialog
          target={models.overrideAction}
          options={options}
          onConfirm={models.confirmOverrideAction}
          onClose={models.closeOverrideAction}
        />
      ) : null}
      {models.trustReview ? (
        <ProjectAgentTrustDialog
          review={models.trustReview}
          onConfirm={models.confirmTrust}
          onClose={models.closeTrustReview}
        />
      ) : null}
    </>
  );
}
