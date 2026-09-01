import type { AgentDefinitionSaveResult, AgentManifestDraft } from '@shared/types/agentManifest';
import { toAgentManifestEditorDraft } from '@shared/types/agentManifest';

export const serializeAgentManifestDraft = (draft: AgentManifestDraft): string => JSON.stringify({
  id: draft.id,
  fileName: draft.fileName,
  name: draft.name,
  description: draft.description,
  argumentHint: draft.argumentHint,
  target: draft.target,
  models: draft.models,
  icon: draft.icon,
  accent: draft.accent,
  disableModelInvocation: draft.disableModelInvocation,
  userInvocable: draft.userInvocable,
  tools: draft.tools,
  skills: draft.skills,
  mcpServers: draft.mcpServers,
  agents: draft.agents,
  handoffs: draft.handoffs,
  metadata: draft.metadata,
  instructions: draft.instructions,
  enabled: draft.enabled,
  maxTurns: draft.maxTurns,
  delete: Boolean(draft.delete),
});

export const getChangedAgentManifestDrafts = (
  current: AgentManifestDraft[],
  saved: AgentManifestDraft[],
): AgentManifestDraft[] => {
  const savedById = new Map(saved.map((draft) => [draft.id, serializeAgentManifestDraft(draft)]));
  return current.filter((draft) => serializeAgentManifestDraft(draft) !== savedById.get(draft.id));
};

export const rollbackAgentManifestDrafts = (
  current: AgentManifestDraft[],
  failed: AgentManifestDraft[],
  saved: AgentManifestDraft[],
): AgentManifestDraft[] => {
  const failedIds = new Set(failed.map((draft) => draft.id));
  const savedById = new Map(saved.map((draft) => [draft.id, draft]));
  const restored = current.flatMap((draft) => {
    if (!failedIds.has(draft.id)) return [draft];
    const previous = savedById.get(draft.id);
    return previous ? [{ ...previous }] : [];
  });
  for (const draft of failed) {
    const previous = savedById.get(draft.id);
    if (previous && !restored.some((entry) => entry.id === draft.id)) restored.push({ ...previous });
  }
  return restored;
};

export function applyAgentDefinitionSaveResults(
  drafts: AgentManifestDraft[],
  submitted: AgentManifestDraft[],
  results: AgentDefinitionSaveResult[],
  currentProjectId?: string | null,
): AgentManifestDraft[] {
  const next = [...drafts];
  submitted.forEach((draft, index) => {
    const result = results[index];
    if (result?.status !== 'committed') return;
    const existingIndex = next.findIndex((entry) => entry.id === draft.id);
    if (result.definition) {
      const restored = toAgentManifestEditorDraft(result.definition, currentProjectId);
      if (existingIndex >= 0) next[existingIndex] = restored;
      else next.push(restored);
      return;
    }
    if (existingIndex >= 0) next.splice(existingIndex, 1);
  });
  return next;
}

export function selectSubmittableAgentManifestDrafts(
  changed: AgentManifestDraft[],
  blockSubmit?: (draft: AgentManifestDraft) => string | null,
  blockProjected?: (projectedDrafts: AgentManifestDraft[]) => string | null,
  projectedDrafts?: AgentManifestDraft[],
): { drafts: AgentManifestDraft[]; blockedReason: string | null } {
  let blockedReason: string | null = null;
  const drafts = blockSubmit
    ? changed.filter((draft) => {
      const reason = blockSubmit(draft);
      if (!reason) return true;
      blockedReason = reason;
      return false;
    })
    : changed;
  if (drafts.length === 0) return { drafts, blockedReason };
  if (!blockProjected || !projectedDrafts) return { drafts, blockedReason };
  const projectedReason = blockProjected(projectedDrafts);
  if (!projectedReason) return { drafts, blockedReason };
  return { drafts: [], blockedReason: projectedReason };
}

export function shouldRollbackFailedAgentManifestSave(
  revision: number,
  latestRevision: number,
  submitted: AgentManifestDraft[],
  current: AgentManifestDraft[],
): boolean {
  if (revision !== latestRevision) return false;
  const currentById = new Map(current.map((draft) => [draft.id, serializeAgentManifestDraft(draft)]));
  return submitted.every((draft) => currentById.get(draft.id) === serializeAgentManifestDraft(draft));
}
