import { AgentBuiltinDiffDialog } from './AgentBuiltinDiffDialog';
import { AgentOverrideDeleteDialog } from './AgentOverrideDeleteDialog';
import { ProjectAgentTrustDialog } from './ProjectAgentTrustDialog';
import type { useAgentModelControls } from './useAgentModelControls';

export function AgentReviewDialogs({
  models,
  onRestore,
}: {
  models: ReturnType<typeof useAgentModelControls>;
  onRestore: () => void;
}) {
  return (
    <>
      {models.builtinDiff ? (
        <AgentBuiltinDiffDialog
          state={models.builtinDiff}
          onClose={models.closeBuiltinDiff}
          onRestore={() => {
            models.closeBuiltinDiff();
            onRestore();
          }}
        />
      ) : null}
      {models.overrideDelete ? (
        <AgentOverrideDeleteDialog
          target={models.overrideDelete}
          onConfirm={models.confirmOverrideDelete}
          onClose={models.closeOverrideDelete}
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
