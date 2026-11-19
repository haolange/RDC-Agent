import type { AgentManifestDefinition, AgentManifestDraft, AgentModelOption } from '@shared/types/agentManifest';
import type { AppSettings } from '@shared/types/settings';
import { canonicalAgentModelId, resolveAgentModel } from '@shared/utils/agentModelRoute';
import type { useI18n } from '../../../../i18n';

type Translate = ReturnType<typeof useI18n>['t'];

export const modelOptionLabel = (canonicalId: string | undefined, options: AgentModelOption[]): string | undefined => (
  canonicalId ? options.find((option) => option.canonicalId === canonicalId)?.modelLabel ?? canonicalId : undefined
);
export type AgentProvenanceScope = AgentManifestDefinition['provenance'] extends infer P
  ? P extends { scope: infer S } ? S : never
  : never;

/** Read-only configuration status from the enabled flag, the model the Agent resolves to, and its tool grant. */
export function configStatus(agent: AgentManifestDraft, settings: AppSettings, t: Translate): { label: string; tone: 'success' | 'warning' | 'error' | 'primary' } {
  if (!agent.enabled) return { label: t('settings.disabled'), tone: 'primary' };
  const resolved = resolveAgentModel(agent.id, settings.agentModels);
  const modelId = resolved.route ? canonicalAgentModelId(resolved.route.providerId, resolved.route.modelId) : '';
  const reasoningLevel = resolved.reasoningLevel;
  if (!modelId) return { label: t('settings.agentStatusNoModel'), tone: 'warning' };
  const option = settings.agents.modelOptions.find((entry) => entry.canonicalId === modelId);
  if (!option) return { label: t('settings.routeReasonModelInvalid'), tone: 'error' };
  if (option.status === 'provider-unavailable') {
    const state = option.providerIssue === 'unconfigured' ? t('settings.agentStatusProviderUnconfigured')
      : option.providerIssue === 'failed' ? t('settings.agentStatusProviderFailed')
        : t('settings.routeReasonProviderUnavailable');
    return { label: option.disabledReason
      ? t('settings.agentStatusProviderDetail', { state, detail: option.disabledReason }) : state, tone: 'warning' };
  }
  if (option.status !== 'ready') return { label: option.disabledReason ?? t('settings.modelUnavailable'), tone: 'warning' };
  if (reasoningLevel && !option.reasoningSelections) return { label: t('settings.agentStatusReasoningUnverified'), tone: 'warning' };
  if (reasoningLevel && !option.reasoningSelections?.includes(reasoningLevel)) return { label: t('settings.agentStatusReasoningUnsupported'), tone: 'error' };
  if (agent.tools.length === 0) return { label: t('settings.agentStatusNoTools'), tone: 'warning' };
  return { label: t('settings.agentStatusAvailable'), tone: 'success' };
}

/** Which model actually runs and, field by field, whether it comes from this Agent or the default. */
export function modelSourceLabel(agent: Pick<AgentManifestDraft, 'id'>, settings: AppSettings, t: Translate): string {
  const resolved = resolveAgentModel(agent.id, settings.agentModels);
  if (!resolved.route) return t('settings.agentModelSourceNone');
  const model = modelOptionLabel(canonicalAgentModelId(resolved.route.providerId, resolved.route.modelId), settings.agents.modelOptions) ?? '';
  const effective = [model, resolved.reasoningLevel].filter(Boolean).join(' · ');
  const own = settings.agentModels.byAgent[agent.id] ?? {};
  const levelFromDefault = !own.reasoningLevel && Boolean(resolved.reasoningLevel);
  if (own.model) return t(levelFromDefault ? 'settings.agentModelSourceLevelDefault' : 'settings.agentModelSourceAgent', { model: effective });
  return t(own.reasoningLevel ? 'settings.agentModelSourceModelDefault' : 'settings.agentModelSourceDefault', { model: effective });
}

export function provenanceLabel(scope: AgentProvenanceScope | null, t: Translate): string {
  if (scope === 'project') return t('settings.scopeProject');
  if (scope === 'user') return t('settings.scopeUser');
  if (scope === 'builtin') return t('settings.scopeBuiltin');
  return t('settings.unsaved');
}
