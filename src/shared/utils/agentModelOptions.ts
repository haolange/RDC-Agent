import { getReasoningSelectionOrder } from '../types/modelCapability';
import { canonicalAgentModelId, splitCanonicalAgentModelId } from './agentModelRoute';
import { classifyAgentToolEligibility, isAgentToolExecutableModel } from './agentToolCapability';
import { isProviderExecutable } from './providerExecutionAvailability';
import type { AgentModelOption } from '../types/agentManifest';
import type { EffectiveCatalogSnapshot, EffectiveModel } from '../types/providerCapability';
import type { AgentModelSettings, LlmAgentRoute, LlmProviderEntry } from '../types/settings';

export interface AgentModelOptionInputs {
  providers: readonly LlmProviderEntry[];
  routes: readonly LlmAgentRoute[];
  agentModels: AgentModelSettings;
  /** The effective catalogs the reader holds; a provider without one offers only its referenced models. */
  catalogs: readonly EffectiveCatalogSnapshot[];
}

/** The providers whose effective catalogs feed the choices: every routed provider and every usable one. */
export function modelOptionCatalogProviderIds(providers: readonly LlmProviderEntry[], routes: readonly LlmAgentRoute[]): Set<string> {
  return new Set([
    ...routes.map((route) => route.providerId).filter(Boolean),
    ...providers.filter((provider) => provider.enabled && provider.isConfigured).map((provider) => provider.id),
  ]);
}

/**
 * The models an Agent can be set to, from the effective catalogs: every Agent-executable model, plus each model a
 * setting or route references (marked with why it cannot run). Computed where the catalogs are, so a catalog change
 * updates the choices without reading the settings again.
 */
export function buildAgentModelOptions({ providers, routes, agentModels, catalogs }: AgentModelOptionInputs): AgentModelOption[] {
  const referenced = new Set([
    ...[agentModels.default, ...Object.values(agentModels.byAgent)].map((binding) => binding.model ?? '').filter(Boolean),
    ...routes.map((route) => canonicalAgentModelId(route.providerId, route.modelId)).filter(Boolean),
  ]);
  const options: AgentModelOption[] = [];
  const seen = new Set<string>();
  const internalTargets = new Set(catalogs.flatMap((catalog) => catalog.models
    .filter((model) => model.selection?.pickerVisibility === 'internal')
    .map((model) => canonicalAgentModelId(catalog.providerId, model.modelId))));
  const addOption = (option: AgentModelOption): void => {
    if (!option.canonicalId || seen.has(option.canonicalId)) return;
    seen.add(option.canonicalId);
    options.push(option);
  };
  const providerIssue = (provider: LlmProviderEntry): Pick<AgentModelOption, 'providerIssue' | 'disabledReason'> => {
    const state = provider.status === 'unconfigured' || provider.status === 'failed'
      ? provider.status : 'unavailable';
    const detail = state === 'failed' ? provider.lastError : state === 'unavailable' ? provider.unavailableReason : undefined;
    return { providerIssue: state, ...(detail ? { disabledReason: detail } : {}) };
  };
  const fromEffectiveModel = (provider: LlmProviderEntry, model: EffectiveModel): AgentModelOption => {
    const canonicalId = canonicalAgentModelId(provider.id, model.modelId);
    const providerUnavailable = !isProviderExecutable(provider);
    const modelDisabled = model.enabled === false;
    const eligibility = classifyAgentToolEligibility(model);
    const toolExecutable = eligibility === 'executable';
    const status: AgentModelOption['status'] = providerUnavailable
      ? 'provider-unavailable'
      : modelDisabled
        ? 'model-disabled'
        : model.availability === 'unavailable' || eligibility === 'unsupported' || eligibility === 'no-adapter'
          ? 'model-unavailable'
          : model.availability === 'available' && toolExecutable
            ? 'ready'
            : 'model-unverified';
    const disabledReason = status === 'provider-unavailable'
      ? undefined
      : status === 'model-disabled'
        ? 'Model is disabled.'
        : status === 'model-unavailable'
          ? eligibility === 'unsupported'
            ? 'This provider route explicitly does not support native structured agent tools.'
            : eligibility === 'no-adapter'
              ? 'This provider route has no implemented native structured-tool adapter.'
              : model.unavailableReason ?? 'Model is unavailable for this account and route.'
          : status === 'model-unverified'
            ? eligibility === 'budget-unknown'
              ? 'Model has no verified positive context budget and cannot be executed safely.'
              : eligibility === 'tools-unknown'
                ? 'Native tool calling is not confirmed for this provider route, so the model is not an Agent-executable choice.'
                : 'Model availability has not been verified for this account and route.'
            : undefined;
    // models.json user overrides are the only layer that carries sourceKind 'user'.
    const isUserOverride = model.provenance.some((evidence) => (
      evidence.source === 'user' && evidence.sourceKind === 'user'
    ));
    return {
      canonicalId,
      providerId: provider.id,
      providerLabel: provider.label || provider.id,
      modelId: model.modelId,
      modelLabel: model.label || model.modelId,
      configured: status === 'ready',
      status,
      reasoningSelections: model.controls.reasoning.kind === 'unknown'
        ? null : getReasoningSelectionOrder(model.controls.reasoning),
      ...(status === 'provider-unavailable' ? providerIssue(provider) : disabledReason ? { disabledReason } : {}),
      ...(model.cost ? { cost: model.cost } : {}),
      ...(isUserOverride ? { custom: true } : {}),
    };
  };

  for (const provider of providers) {
    if (provider.catalogOwnership !== 'user-managed') {
      const snapshot = catalogs.find((catalog) => (
        catalog.providerId === provider.id
        && catalog.accountId === (provider.activeAccountId ?? `anonymous:${provider.id}`)
        && catalog.protocol === provider.protocol
      ));
      for (const model of snapshot?.models ?? []) {
        if (model.selection?.pickerVisibility === 'internal') continue;
        const canonicalId = canonicalAgentModelId(provider.id, model.modelId);
        const executable = isAgentToolExecutableModel(model);
        if (executable || referenced.has(canonicalId)) {
          addOption(fromEffectiveModel(provider, model));
        }
      }
      continue;
    }
    const snapshot = catalogs.find((catalog) => (
      catalog.providerId === provider.id
      && catalog.accountId === (provider.activeAccountId ?? `anonymous:${provider.id}`)
      && catalog.protocol === provider.protocol
    ));
    for (const model of provider.models) {
      const canonicalId = canonicalAgentModelId(provider.id, model.id);
      const effective = snapshot?.models.find((entry) => (
        entry.modelId === model.id || entry.aliases.includes(model.id)
      ));
      if (effective) {
        const executable = isAgentToolExecutableModel(effective);
        if (executable || referenced.has(canonicalId)) {
          addOption(fromEffectiveModel(provider, effective));
        }
        continue;
      }
      if (!referenced.has(canonicalId)) continue;
      const providerUnavailable = !isProviderExecutable(provider);
      const disabled = model.enabled === false;
      const status: AgentModelOption['status'] = providerUnavailable
        ? 'provider-unavailable'
        : disabled ? 'model-disabled' : 'model-unverified';
      addOption({
        canonicalId,
        providerId: provider.id,
        providerLabel: provider.label || provider.id,
        modelId: model.id,
        modelLabel: model.label || model.id,
        configured: false,
        status,
        ...(status === 'provider-unavailable'
          ? providerIssue(provider)
          : status === 'model-disabled'
            ? { disabledReason: 'Model is disabled.' }
            : { disabledReason: 'Native tool calling is not confirmed for this provider route, so the model is not an Agent-executable choice.' }),
      });
    }
  }

  for (const canonicalId of referenced) {
    if (seen.has(canonicalId) || internalTargets.has(canonicalId)) continue;
    const parsed = splitCanonicalAgentModelId(canonicalId);
    if (!parsed) continue;
    const provider = providers.find((entry) => entry.id === parsed.providerId);
    addOption({
      canonicalId,
      providerId: parsed.providerId,
      providerLabel: provider?.label || parsed.providerId,
      modelId: parsed.modelId,
      modelLabel: parsed.modelId,
      configured: false,
      ...(provider && !isProviderExecutable(provider)
        ? { status: 'provider-unavailable' as const, ...providerIssue(provider) }
        : { status: 'missing' as const, disabledReason: 'This model is not present in the current account catalog.' }),
    });
  }

  return options.sort((left, right) => (
    left.providerLabel.localeCompare(right.providerLabel)
    || Number(right.configured) - Number(left.configured)
    || left.modelLabel.localeCompare(right.modelLabel)
  ));
}
