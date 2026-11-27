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

/** A binding's own fields where present, otherwise the default's, field by field. */
function resolveBinding(
  own: import('../types/settings').AgentModelBinding,
  fallback: import('../types/settings').AgentModelBinding,
): ResolvedAgentModel {
  const model = own.model ?? fallback.model;
  const reasoningLevel = own.reasoningLevel ?? fallback.reasoningLevel;
  return {
    route: model ? splitCanonicalAgentModelId(model) : null,
    ...(reasoningLevel ? { reasoningLevel } : {}),
    source: own.model ? 'agent' : fallback.model ? 'default' : 'none',
  };
}

/**
 * The model and reasoning level an Agent runs with: its own setting where present, otherwise the
 * default, field by field. Delegated children resolve their own Agent; nothing is inherited from a parent.
 */
export function resolveAgentModel(
  agentId: string,
  settings: import('../types/settings').AgentModelSettings,
): ResolvedAgentModel {
  return resolveBinding(settings.byAgent[agentId] ?? {}, settings.default);
}

/**
 * The model and reasoning level auto-review runs with: its own setting where present, otherwise the default, field
 * by field. It never follows the turn under review.
 */
export function resolvePermissionReviewModel(
  settings: import('../types/settings').AgentModelSettings,
): ResolvedAgentModel {
  return resolveBinding(settings.review ?? {}, settings.default);
}
