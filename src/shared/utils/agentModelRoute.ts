export interface CanonicalAgentModelId {
  providerId: string;
  modelId: string;
}

export const canonicalAgentModelId = (providerId: string, modelId: string): string =>
  providerId.trim() && modelId.trim() ? `${providerId.trim()}:${modelId.trim()}` : '';

export const splitCanonicalAgentModelId = (value: string): CanonicalAgentModelId | null => {
  const separator = value.indexOf(':');
  if (separator <= 0 || separator === value.length - 1) {
    return null;
  }
  const providerId = value.slice(0, separator).trim();
  const modelId = value.slice(separator + 1).trim();
  return providerId && modelId ? { providerId, modelId } : null;
};

export interface ResolvedAgentModel {
  route: CanonicalAgentModelId | null;
  reasoningLevel?: import('../types/modelCapability').ReasoningSelection;
  source: 'agent' | 'default' | 'none';
}

/**
 * The model and reasoning level an Agent runs with: its own setting where present, otherwise the
 * default, field by field. Delegated children resolve their own Agent; nothing is inherited from a parent.
 */
export function resolveAgentModel(
  agentId: string,
  settings: import('../types/settings').AgentModelSettings,
): ResolvedAgentModel {
  const own = settings.byAgent[agentId] ?? {};
  const model = own.model ?? settings.default.model;
  const reasoningLevel = own.reasoningLevel ?? settings.default.reasoningLevel;
  return {
    route: model ? splitCanonicalAgentModelId(model) : null,
    ...(reasoningLevel ? { reasoningLevel } : {}),
    source: own.model ? 'agent' : settings.default.model ? 'default' : 'none',
  };
}
