import type { ReasoningVisibilityRequest } from '@shared/provider-catalog/modelManifestSchema';
import type { NamedReasoningLevel, ResolvedReasoningSelection } from '@shared/types/modelCapability';
import type { RequestPlan } from '@shared/types/providerCapability';

function resolveWireLevel(reasoning: ResolvedReasoningSelection): NamedReasoningLevel | null {
  if (reasoning.selection === 'off' || reasoning.selection === 'unknown') {
    return null;
  }
  if (reasoning.selection === 'on') {
    switch (reasoning.control.wireProfile.kind) {
      case 'openai-responses':
      case 'openai-compatible':
      case 'anthropic':
      case 'gemini-thinking-level':
      case 'gemini-thinking-budget':
        return reasoning.control.wireProfile.on;
      case 'moonshot-thinking':
      case 'none':
      default:
        return null;
    }
  }
  return reasoning.selection;
}

export function isReasoningEnabled(reasoning: ResolvedReasoningSelection | undefined): boolean {
  return reasoning ? reasoning.selection !== 'off' && reasoning.selection !== 'unknown' : false;
}

/**
 * The route's declared request for visible reasoning, and only while reasoning is on. Adapters read this
 * one fact; they never infer it from the contract semantic or the provider id.
 */
export function reasoningVisibilityRequest(options: {
  reasoning?: ResolvedReasoningSelection;
  requestPlan?: Pick<RequestPlan, 'contracts'>;
}): ReasoningVisibilityRequest | null {
  if (!isReasoningEnabled(options.reasoning)) return null;
  return options.requestPlan?.contracts.reasoning.visibilityRequest ?? null;
}

export function buildOpenAiResponsesReasoning(
  reasoning: ResolvedReasoningSelection | undefined,
  visibilityRequest: ReasoningVisibilityRequest | null,
): { reasoning?: Record<string, unknown>; include?: string[] } {
  if (!reasoning || reasoning.control.wireProfile.kind !== 'openai-responses') {
    return {};
  }

  const profile = reasoning.control.wireProfile;
  const wireLevel = resolveWireLevel(reasoning);
  if (!wireLevel) {
    if (profile.offMode === 'reasoning-none') {
      return { reasoning: { effort: 'none' } };
    }
    return {};
  }

  const effort = profile.levels[wireLevel];
  if (!effort) {
    return {};
  }

  const nextReasoning: Record<string, unknown> = { effort };
  if (visibilityRequest === 'responses-summary') {
    nextReasoning.summary = 'auto';
  }
  return {
    reasoning: nextReasoning,
    include: ['reasoning.encrypted_content'],
  };
}

export function applyOpenAiCompatibleReasoning(
  body: Record<string, unknown>,
  reasoning: ResolvedReasoningSelection | undefined,
): void {
  if (!reasoning || reasoning.control.wireProfile.kind !== 'openai-compatible') {
    return;
  }

  const profile = reasoning.control.wireProfile;
  const wireLevel = resolveWireLevel(reasoning);

  if (!wireLevel) {
    if (profile.offMode === 'reasoning-none') {
      body.reasoning_effort = 'none';
    } else if (profile.offMode === 'enable-thinking-false') {
      body.enable_thinking = false;
    } else if (profile.offMode === 'thinking-disabled') {
      body.thinking = { type: 'disabled' };
    }
    return;
  }

  if (profile.onMode === 'enable-thinking-true') {
    body.enable_thinking = true;
  } else if (profile.onMode === 'thinking-enabled') {
    body.thinking = { type: 'enabled' };
  }

  const effort = profile.levels?.[wireLevel];
  if (effort) {
    body.reasoning_effort = effort;
  }
}

export function applyAnthropicReasoning(
  body: Record<string, unknown>,
  reasoning: ResolvedReasoningSelection | undefined,
  visibilityRequest: ReasoningVisibilityRequest | null,
): void {
  if (!reasoning || reasoning.control.wireProfile.kind !== 'anthropic') {
    return;
  }

  const profile = reasoning.control.wireProfile;
  const wireLevel = resolveWireLevel(reasoning);

  if (!wireLevel) {
    if (profile.offMode === 'disabled') {
      body.thinking = { type: 'disabled' };
    }
    return;
  }

  if (profile.onMode === 'adaptive' || profile.onMode === 'enabled') {
    const thinking: Record<string, unknown> = { type: profile.onMode };
    if (typeof profile.onBudgetTokens === 'number') {
      thinking.budget_tokens = profile.onBudgetTokens;
    }
    if (visibilityRequest === 'anthropic-display') {
      thinking.display = 'summarized';
    }
    body.thinking = thinking;
  }

  const effort = profile.levels?.[wireLevel];
  if (effort) {
    body.output_config = { effort };
  }
}

export function applyGeminiReasoning(
  generationConfig: Record<string, unknown>,
  reasoning: ResolvedReasoningSelection | undefined,
  visibilityRequest: ReasoningVisibilityRequest | null,
): void {
  if (!reasoning) {
    return;
  }
  const withThoughts = (thinkingConfig: Record<string, unknown>) =>
    visibilityRequest === 'gemini-include-thoughts' ? { ...thinkingConfig, includeThoughts: true } : thinkingConfig;

  const wireLevel = resolveWireLevel(reasoning);
  if (reasoning.control.wireProfile.kind === 'gemini-thinking-level') {
    if (!wireLevel) {
      return;
    }
    const thinkingLevel = reasoning.control.wireProfile.levels[wireLevel];
    if (thinkingLevel) {
      generationConfig.thinkingConfig = withThoughts({ thinkingLevel: thinkingLevel.toUpperCase() });
    }
    return;
  }

  if (reasoning.control.wireProfile.kind === 'gemini-thinking-budget') {
    if (!wireLevel) {
      generationConfig.thinkingConfig = { thinkingBudget: reasoning.control.wireProfile.offBudget ?? 0 };
      return;
    }
    const thinkingBudget = reasoning.control.wireProfile.levels[wireLevel];
    if (typeof thinkingBudget === 'number') {
      generationConfig.thinkingConfig = withThoughts({ thinkingBudget });
    }
  }
}

export function applyGoogleInteractionsReasoning(
  generationConfig: Record<string, unknown>,
  reasoning: ResolvedReasoningSelection | undefined,
  visibilityRequest: ReasoningVisibilityRequest | null,
): void {
  if (!reasoning || reasoning.control.wireProfile.kind !== 'gemini-thinking-level') return;
  const wireLevel = resolveWireLevel(reasoning);
  if (!wireLevel) return;
  const thinkingLevel = reasoning.control.wireProfile.levels[wireLevel];
  if (!thinkingLevel) return;
  generationConfig.thinking_level = thinkingLevel;
  if (visibilityRequest === 'gemini-interactions-summaries') generationConfig.thinking_summaries = 'auto';
}

export function applyMoonshotReasoning(
  body: Record<string, unknown>,
  reasoning: ResolvedReasoningSelection | undefined,
): void {
  if (!reasoning || reasoning.control.wireProfile.kind !== 'moonshot-thinking') {
    return;
  }

  if (reasoning.selection === 'off') {
    if (reasoning.control.wireProfile.offMode === 'disabled') {
      body.thinking = { type: 'disabled' };
    }
    return;
  }

  if (reasoning.control.wireProfile.onMode === 'enabled') {
    body.thinking = { type: 'enabled' };
  }
}

export function applyReasoningToAnthropicLikeBody(
  body: Record<string, unknown>,
  reasoning: ResolvedReasoningSelection | undefined,
  visibilityRequest: ReasoningVisibilityRequest | null,
): void {
  if (!reasoning) {
    return;
  }
  if (reasoning.control.wireProfile.kind === 'moonshot-thinking') {
    applyMoonshotReasoning(body, reasoning);
    return;
  }
  applyAnthropicReasoning(body, reasoning, visibilityRequest);
}

/** Ollama's `think` switches thinking on or off; it is sent only for models whose reasoning control is known. */
export function applyOllamaThink(
  body: Record<string, unknown>,
  reasoning: ResolvedReasoningSelection | undefined,
  requestPlan: Pick<RequestPlan, 'contracts'> | undefined,
): void {
  if (!reasoning || reasoning.selection === 'unknown' || reasoning.control.kind === 'none') return;
  if (requestPlan?.contracts.reasoning.visibilityRequest !== 'ollama-think') return;
  body.think = isReasoningEnabled(reasoning);
}
