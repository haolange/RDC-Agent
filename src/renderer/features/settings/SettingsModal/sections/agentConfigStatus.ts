import { canonicalAgentModelId, resolveAgentModel } from '@shared/utils/agentModelRoute';
import type { AgentManifestDefinition, AgentManifestDraft, AgentModelOption } from '@shared/types/agentManifest';
import type { AppSettings } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';

type Translate = ReturnType<typeof useI18n>['t'];

export const modelOptionLabel = (canonicalId: string | undefined, options: AgentModelOption[]): string | undefined => (
  canonicalId ? options.find((option) => option.canonicalId === canonicalId)?.modelLabel ?? canonicalId : undefined
);
export type AgentProvenanceScope = AgentManifestDefinition['provenance'] extends infer P
  ? P extends { scope: infer S } ? S : never
  : never;

/** An Agent's configuration problem, if any: a short sentence, its tone, and the technical reason for the tooltip. */
export interface AgentConfigStatus {
  label: string;
  tone: 'success' | 'warning' | 'error' | 'primary';
  detail?: string;
}

/** Read-only configuration status from the enabled flag, the model the Agent resolves to, and its tool grant. */
export function configStatus(agent: AgentManifestDraft, settings: AppSettings, modelOptions: AgentModelOption[], t: Translate): AgentConfigStatus {
  if (!agent.enabled) return { label: t('settings.disabled'), tone: 'primary' };
  const resolved = resolveAgentModel(agent.id, settings.agentModels);
  const modelId = resolved.route ? canonicalAgentModelId(resolved.route.providerId, resolved.route.modelId) : '';
  const reasoningLevel = resolved.reasoningLevel;
  if (!modelId) return { label: t('settings.agentStatusNoModel'), tone: 'warning' };
  const option = modelOptions.find((entry) => entry.canonicalId === modelId);
  if (!option) return { label: t('settings.routeReasonModelInvalid'), tone: 'error' };
  const detail = option.disabledReason ? { detail: option.disabledReason } : {};
  if (option.status === 'provider-unavailable') {
    const label = option.providerIssue === 'unconfigured' ? t('settings.agentStatusProviderUnconfigured')
      : option.providerIssue === 'failed' ? t('settings.agentStatusProviderFailed')
        : t('settings.routeReasonProviderUnavailable');
    return { label, tone: 'warning', ...detail };
  }
  if (option.status !== 'ready') return { label: t('settings.modelUnavailable'), tone: 'warning', ...detail };
  if (reasoningLevel && !option.reasoningSelections) return { label: t('settings.agentStatusReasoningUnverified'), tone: 'warning' };
  if (reasoningLevel && !option.reasoningSelections?.includes(reasoningLevel)) return { label: t('settings.agentStatusReasoningUnsupported'), tone: 'error' };
  if (agent.tools.length === 0) return { label: t('settings.agentStatusNoTools'), tone: 'warning' };
  return { label: t('settings.agentStatusAvailable'), tone: 'success' };
}

/** Where an Agent definition comes from, in words; a draft not yet written has no source. */
export function provenanceLabel(scope: AgentProvenanceScope | null, t: Translate): string {
  if (scope === 'project') return t('settings.scopeProject');
  if (scope === 'user') return t('settings.scopeUser');
  if (scope === 'builtin') return t('settings.scopeBuiltin');
  return t('settings.unsaved');
}
