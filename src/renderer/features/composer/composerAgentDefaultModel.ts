import type { ComposerModelPickerOption } from './composerModelPicker';

export const COMPOSER_MODEL_AGENT_DEFAULT_TOKEN = 'default';

export type ComposerAgentDefaultKind = 'unset' | 'pending' | 'available' | 'unavailable';

export interface ComposerAgentDefaultRoute {
  providerId?: string;
  modelId?: string;
}

export interface ComposerAgentDefaultState {
  kind: ComposerAgentDefaultKind;
  selectable: boolean;
  providerId?: string;
  modelId?: string;
  providerLabel?: string;
  modelLabel?: string;
}

export function isComposerAgentDefaultToken(raw: string): boolean {
  return raw.trim().toLowerCase() === COMPOSER_MODEL_AGENT_DEFAULT_TOKEN;
}

export function resolveComposerAgentDefaultState(
  agentRoute: ComposerAgentDefaultRoute | null | undefined,
  options: readonly ComposerModelPickerOption[],
  catalogReady: boolean,
): ComposerAgentDefaultState {
  const providerId = agentRoute?.providerId?.trim() ?? '';
  const modelId = agentRoute?.modelId?.trim() ?? '';
  if (!providerId || !modelId) {
    return { kind: 'unset', selectable: false };
  }

  const match = options.find((option) => (
    option.providerId === providerId && option.modelId === modelId
  ));
  if (match) {
    return {
      kind: 'available',
      selectable: true,
      providerId,
      modelId,
      providerLabel: match.providerLabel,
      modelLabel: match.label,
    };
  }
  if (!catalogReady) {
    return {
      kind: 'pending',
      selectable: true,
      providerId,
      modelId,
    };
  }
  return {
    kind: 'unavailable',
    selectable: false,
    providerId,
    modelId,
  };
}
