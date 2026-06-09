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
