import { useState } from 'react';
import type {
  AgentBuiltinComparison,
  AgentManifestDiagnostic,
  AgentManifestDraft,
  AgentModelMigrationPreview,
  AgentOverrideFileRequest,
} from '@shared/types/agentManifest';
import type { AgentModelBinding, AgentModelSettings, AppSettings } from '@shared/types/settings';
import { diffLines } from '@shared/utils/lineDiff';
import type { useI18n } from '../../../../i18n';
import type { AgentBuiltinDiffState } from './AgentBuiltinDiffDialog';
import type { AgentOverrideFileAction } from './AgentModelMigrationDialog';

type Translate = ReturnType<typeof useI18n>['t'];

/** Where a failed model write is reported: the default row, or one Agent's editor. */
export const DEFAULT_MODEL_TARGET = '';

export interface AgentModelCommands {
  onAgentModelsChange: (agentModels: AgentModelSettings) => Promise<void>;
  onPreviewAgentModelMigration: (sourcePath: string) => Promise<AgentModelMigrationPreview>;
  onCommitAgentOverrideFile: (action: 'migrate' | 'delete', request: AgentOverrideFileRequest) => Promise<void>;
  onLoadAgentBuiltinComparison: (draft: AgentManifestDraft) => Promise<AgentBuiltinComparison>;
}

const errorText = (error: unknown, fallback: string): string => (error instanceof Error && error.message ? error.message : fallback);
const hasValue = (binding: AgentModelBinding): boolean => Boolean(binding.model || binding.reasoningLevel);

/** Model settings and override-file dialogs of the Agents page. */
export function useAgentModelControls(settings: AppSettings, commands: AgentModelCommands, t: Translate) {
  const [modelError, setModelError] = useState<{ target: string; message: string } | null>(null);
  const [builtinDiff, setBuiltinDiff] = useState<AgentBuiltinDiffState | null>(null);
  const [overrideAction, setOverrideAction] = useState<AgentOverrideFileAction | null>(null);

  const commit = (agentModels: AgentModelSettings, target: string) => {
    setModelError(null);
    void commands.onAgentModelsChange(agentModels).catch((error: unknown) => {
      setModelError({ target, message: errorText(error, t('settings.agentModelSaveFailed')) });
    });
  };

  const setDefaultBinding = (binding: AgentModelBinding) => commit({ ...settings.agentModels, default: binding }, DEFAULT_MODEL_TARGET);

  const setAgentBinding = (agentId: string, binding: AgentModelBinding) => {
    const byAgent = Object.fromEntries(Object.entries(settings.agentModels.byAgent).filter(([id]) => id !== agentId));
    commit({ ...settings.agentModels, byAgent: hasValue(binding) ? { ...byAgent, [agentId]: binding } : byAgent }, agentId);
  };

  const showBuiltinDiff = (draft: AgentManifestDraft, updated: boolean) => {
    setBuiltinDiff({ agentId: draft.id, agentName: draft.name || draft.id, updated });
    void commands.onLoadAgentBuiltinComparison(draft).then(
      (comparison) => setBuiltinDiff((current) => (current?.agentId === draft.id
        ? { ...current, lines: diffLines(comparison.builtinContent, comparison.overrideContent) } : current)),
      (error: unknown) => setBuiltinDiff((current) => (current?.agentId === draft.id
        ? { ...current, error: errorText(error, t('settings.agentBuiltinDiffFailed')) } : current)),
    );
  };

  const openOverrideAction = (action: AgentOverrideFileAction['action'], issue: AgentManifestDiagnostic) => {
    const same = (current: AgentOverrideFileAction | null) => current?.sourcePath === issue.sourcePath && current.action === action;
    setOverrideAction({ action, agentId: issue.agentId, sourcePath: issue.sourcePath });
    void commands.onPreviewAgentModelMigration(issue.sourcePath).then(
      (preview) => setOverrideAction((current) => (same(current) ? { ...current!, preview } : current)),
      (error: unknown) => setOverrideAction((current) => (same(current)
        ? { ...current!, error: errorText(error, t('settings.agentModelMigrationFailed')) } : current)),
    );
  };

  const confirmOverrideAction = async (preview: AgentModelMigrationPreview) => {
    if (!overrideAction) return;
    await commands.onCommitAgentOverrideFile(overrideAction.action, { sourcePath: preview.sourcePath, sourceHash: preview.sourceHash });
    setOverrideAction(null);
  };

  return {
    modelError,
    setDefaultBinding,
    setAgentBinding,
    builtinDiff,
    showBuiltinDiff,
    closeBuiltinDiff: () => setBuiltinDiff(null),
    overrideAction,
    openOverrideAction,
    confirmOverrideAction,
    closeOverrideAction: () => setOverrideAction(null),
  };
}
