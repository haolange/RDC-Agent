import type { SessionModelOverride } from '@shared/types/session';

export interface ComposerModelRouteSeed {
  providerId?: string;
  modelId?: string;
}

export function resolveComposerEffectiveModel(
  sessionOverride: SessionModelOverride | null | undefined,
  draftModel: SessionModelOverride | null | undefined,
  agentRoute: ComposerModelRouteSeed | null | undefined,
): SessionModelOverride | null {
  if (sessionOverride?.providerId && sessionOverride.modelId) {
    return sessionOverride;
  }
  if (draftModel?.providerId && draftModel.modelId) {
    return draftModel;
  }
  if (agentRoute?.providerId && agentRoute.modelId) {
    return { providerId: agentRoute.providerId, modelId: agentRoute.modelId };
  }
  return null;
}

export function readCompiledComposerRoute(
  settings: {
    agents?: {
      definitions?: Array<{ id: string; compiledRoute?: ComposerModelRouteSeed }>;
    };
  },
  agentId: string,
): ComposerModelRouteSeed | null {
  const compiled = settings.agents?.definitions?.find((entry) => entry.id === agentId)?.compiledRoute;
  if (!compiled?.providerId || !compiled.modelId) return null;
  return compiled;
}

export function hasComposerModelChoice(
  sessionOverride: SessionModelOverride | null | undefined,
  draftModel: SessionModelOverride | null | undefined,
): boolean {
  return Boolean(
    (sessionOverride?.providerId && sessionOverride.modelId)
    || (draftModel?.providerId && draftModel.modelId),
  );
}
