import type { AgentHandoffDefinition, AgentManifestDefinition, AgentModelOption } from '@shared/types/agentManifest';
import { isAgentModelSelectionInvalid } from './AgentModelCascadeSelect';
import { handoffLabelTranslationsSchema } from '@shared/utils/handoffLabels';

export type AgentHandoffIssueCode =
  | 'label-required'
  | 'target-required'
  | 'target-unknown'
  | 'target-disabled'
  | 'target-self'
  | 'prompt-required'
  | 'model-invalid'
  | 'translations-invalid';

export interface AgentHandoffIssue {
  index: number;
  field: 'label' | 'agent' | 'prompt' | 'model' | 'labelTranslations';
  code: AgentHandoffIssueCode;
}

export const AGENT_HANDOFF_ISSUE_KEYS = {
  'label-required': 'settings.agentHandoffErrorLabelRequired',
  'target-required': 'settings.agentHandoffErrorTargetRequired',
  'target-unknown': 'settings.agentHandoffErrorTargetUnknown',
  'target-disabled': 'settings.agentHandoffErrorTargetDisabled',
  'target-self': 'settings.agentHandoffErrorTargetSelf',
  'prompt-required': 'settings.agentHandoffErrorPromptRequired',
  'model-invalid': 'settings.agentHandoffErrorModelInvalid',
  'translations-invalid': 'settings.agentHandoffErrorTranslationsInvalid',
} as const;

export const IMMEDIATE_HANDOFF_ISSUE_CODES: ReadonlySet<AgentHandoffIssueCode> = new Set([
  'target-unknown',
  'target-disabled',
  'model-invalid',
  'translations-invalid',
]);

export function persistAgentHandoff(handoff: AgentHandoffDefinition): AgentHandoffDefinition {
  const next: AgentHandoffDefinition = {
    label: handoff.label,
    agent: handoff.agent,
    prompt: handoff.prompt,
  };
  if (handoff.labelTranslations) next.labelTranslations = { ...handoff.labelTranslations };
  if (handoff.send === true) next.send = true;
  if (handoff.surface && handoff.surface !== 'turn-end') next.surface = handoff.surface;
  const model = handoff.model?.trim();
  if (model) next.model = model;
  const requiredSkillIds = (handoff.requiredSkillIds ?? [])
    .map((id) => id.trim())
    .filter(Boolean);
  if (requiredSkillIds.length > 0) next.requiredSkillIds = requiredSkillIds;
  const requiredToolIds = (handoff.requiredToolIds ?? []).map((id) => id.trim()).filter(Boolean);
  if (requiredToolIds.length > 0) next.requiredToolIds = requiredToolIds;
  return next;
}

export type AgentHandoffTargetRef = Pick<AgentManifestDefinition, 'id' | 'enabled'>;

export interface ProjectedHandoffTargetConflict {
  sourceId: string;
  targetId: string;
  code: 'target-unknown' | 'target-disabled';
}

export function validateAgentHandoffs(
  handoffs: AgentHandoffDefinition[],
  ctx: { selfId: string; definitions: AgentHandoffTargetRef[]; modelOptions: AgentModelOption[] },
): AgentHandoffIssue[] {
  const issues: AgentHandoffIssue[] = [];
  const byId = new Map(ctx.definitions.map((entry) => [entry.id, entry]));
  handoffs.forEach((handoff, index) => {
    if (!handoff.label.trim()) issues.push({ index, field: 'label', code: 'label-required' });
    if (handoff.labelTranslations !== undefined && !handoffLabelTranslationsSchema.safeParse(handoff.labelTranslations).success) {
      issues.push({ index, field: 'labelTranslations', code: 'translations-invalid' });
    }
    const agent = handoff.agent.trim();
    if (!agent) {
      issues.push({ index, field: 'agent', code: 'target-required' });
    } else if (agent === ctx.selfId) {
      issues.push({ index, field: 'agent', code: 'target-self' });
    } else {
      const target = byId.get(agent);
      if (!target) issues.push({ index, field: 'agent', code: 'target-unknown' });
      else if (!target.enabled) issues.push({ index, field: 'agent', code: 'target-disabled' });
    }
    if (!handoff.prompt.trim()) issues.push({ index, field: 'prompt', code: 'prompt-required' });
    if (isAgentModelSelectionInvalid(handoff.model ?? '', ctx.modelOptions)) {
      issues.push({ index, field: 'model', code: 'model-invalid' });
    }
  });
  return issues;
}

export function findProjectedHandoffTargetConflicts(
  drafts: Array<{ id: string; enabled: boolean; delete?: boolean; handoffs: AgentHandoffDefinition[] }>,
): ProjectedHandoffTargetConflict[] {
  const definitions = drafts.filter((draft) => !draft.delete);
  const conflicts: ProjectedHandoffTargetConflict[] = [];
  for (const draft of definitions) {
    for (const issue of validateAgentHandoffs(draft.handoffs, {
      selfId: draft.id,
      definitions,
      modelOptions: [],
    })) {
      if (issue.code !== 'target-unknown' && issue.code !== 'target-disabled') continue;
      conflicts.push({
        sourceId: draft.id,
        targetId: draft.handoffs[issue.index]?.agent ?? '',
        code: issue.code,
      });
    }
  }
  return conflicts;
}
