import { useState } from 'react';
import { diffLines } from '@shared/utils/lineDiff';
import { errorDetail } from '../../../../lib/errorDetail';
import type {
  AgentBuiltinComparison,
  AgentManifestDiagnostic,
  AgentManifestDraft,
  AgentOverrideFilePreview,
  AgentOverrideFileRequest,
  ProjectAgentTrustPreview,
} from '@shared/types/agentManifest';
import type { SettingsPatchOp } from '@shared/types/settings';
import type { AgentModelFieldChange } from './AgentModelBindingFields';
import type { AgentBuiltinDiffState } from './AgentBuiltinDiffDialog';
import type { AgentOverrideDeleteTarget } from './AgentOverrideDeleteDialog';
import type { ProjectAgentTrustReview } from './ProjectAgentTrustDialog';

/** Where a failed model write is reported: the default row, or one Agent's editor. */
export const DEFAULT_MODEL_TARGET = '';

export interface AgentModelCommands {
  onAgentModelOps: (ops: SettingsPatchOp[]) => Promise<void>;
  onPreviewAgentOverrideFile: (sourcePath: string) => Promise<AgentOverrideFilePreview>;
  onDeleteAgentOverrideFile: (request: AgentOverrideFileRequest) => Promise<void>;
  onLoadAgentBuiltinComparison: (draft: AgentManifestDraft) => Promise<AgentBuiltinComparison>;
  onPreviewProjectAgentTrust: (sourcePath: string) => Promise<ProjectAgentTrustPreview>;
  onTrustProjectAgent: (request: AgentOverrideFileRequest) => Promise<void>;
}

const defaultFieldOp = (change: AgentModelFieldChange): SettingsPatchOp =>
  change.field === 'model'
    ? { op: 'agentModels.setDefault', field: 'model', value: change.value ?? null }
    : { op: 'agentModels.setDefault', field: 'reasoningLevel', value: change.value ?? null };

const agentFieldOp = (agentId: string, change: AgentModelFieldChange): SettingsPatchOp => {
  if (change.value === undefined) return { op: 'agentModels.clearAgentField', agentId, field: change.field };
  return change.field === 'model'
    ? { op: 'agentModels.setAgentField', agentId, field: 'model', value: change.value }
    : { op: 'agentModels.setAgentField', agentId, field: 'reasoningLevel', value: change.value };
};

/**
 * Model settings and override-file dialogs of the Agents page. Each control commits only the field it changed, so
 * edits made before an earlier save returns never overwrite each other.
 */
export function useAgentModelControls(commands: AgentModelCommands) {
  const [modelError, setModelError] = useState<{ target: string; message: string } | null>(null);
  const [builtinDiff, setBuiltinDiff] = useState<AgentBuiltinDiffState | null>(null);
  const [overrideDelete, setOverrideDelete] = useState<AgentOverrideDeleteTarget | null>(null);
  const [trustReview, setTrustReview] = useState<ProjectAgentTrustReview | null>(null);

  const commit = (op: SettingsPatchOp, target: string) => {
    setModelError(null);
    void commands.onAgentModelOps([op]).catch((error: unknown) => {
      setModelError({ target, message: errorDetail(error) });
    });
  };

  const setDefaultField = (change: AgentModelFieldChange) => commit(defaultFieldOp(change), DEFAULT_MODEL_TARGET);

  const setAgentField = (agentId: string, change: AgentModelFieldChange) =>
    commit(agentFieldOp(agentId, change), agentId);

  const showBuiltinDiff = (draft: AgentManifestDraft, updated: boolean) => {
    setBuiltinDiff({ agentId: draft.id, agentName: draft.name || draft.id, updated });
    void commands.onLoadAgentBuiltinComparison(draft).then(
      (comparison) =>
        setBuiltinDiff((current) =>
          current?.agentId === draft.id
            ? { ...current, lines: diffLines(comparison.builtinContent, comparison.overrideContent) }
            : current,
        ),
      (error: unknown) =>
        setBuiltinDiff((current) =>
          current?.agentId === draft.id ? { ...current, error: errorDetail(error) } : current,
        ),
    );
  };

  const openOverrideDelete = (issue: AgentManifestDiagnostic) => {
    const same = (current: AgentOverrideDeleteTarget | null) => current?.sourcePath === issue.sourcePath;
    setOverrideDelete({ agentId: issue.agentId, sourcePath: issue.sourcePath });
    void commands.onPreviewAgentOverrideFile(issue.sourcePath).then(
      (preview) => setOverrideDelete((current) => (same(current) ? { ...current!, preview } : current)),
      (error: unknown) =>
        setOverrideDelete((current) => (same(current) ? { ...current!, error: errorDetail(error) } : current)),
    );
  };

  const confirmOverrideDelete = async (preview: AgentOverrideFilePreview) => {
    await commands.onDeleteAgentOverrideFile({ sourcePath: preview.sourcePath, sourceHash: preview.sourceHash });
    setOverrideDelete(null);
  };

  const openTrustReview = (issue: AgentManifestDiagnostic) => {
    const same = (current: ProjectAgentTrustReview | null) => current?.sourcePath === issue.sourcePath;
    setTrustReview({ agentId: issue.agentId, sourcePath: issue.sourcePath });
    void commands.onPreviewProjectAgentTrust(issue.sourcePath).then(
      (preview) => setTrustReview((current) => (same(current) ? { ...current!, preview } : current)),
      (error: unknown) =>
        setTrustReview((current) => (same(current) ? { ...current!, error: errorDetail(error) } : current)),
    );
  };

  const confirmTrust = async (preview: ProjectAgentTrustPreview) => {
    await commands.onTrustProjectAgent({ sourcePath: preview.sourcePath, sourceHash: preview.sourceHash });
    setTrustReview(null);
  };

  return {
    modelError,
    setDefaultField,
    setAgentField,
    builtinDiff,
    showBuiltinDiff,
    closeBuiltinDiff: () => setBuiltinDiff(null),
    overrideDelete,
    openOverrideDelete,
    confirmOverrideDelete,
    closeOverrideDelete: () => setOverrideDelete(null),
    trustReview,
    openTrustReview,
    confirmTrust,
    closeTrustReview: () => setTrustReview(null),
  };
}
