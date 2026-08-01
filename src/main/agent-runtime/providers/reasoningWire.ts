import type { ReasoningVisibility } from '@shared/types/agentRuntime';
import type {
  NamedReasoningLevel,
  ResolvedReasoningSelection,
} from '@shared/types/modelCapability';

function resolveWireLevel(
  reasoning: ResolvedReasoningSelection,
): NamedReasoningLevel | null {
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

export function buildOpenAiResponsesReasoning(
  reasoning: ResolvedReasoningSelection | undefined,
  reasoningVisibility?: ReasoningVisibility,
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
  if (reasoningVisibility === 'summary-events') {
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
  reasoningVisibility?: ReasoningVisibility,
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
    if (reasoningVisibility === 'summary-events') {
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
): void {
  if (!reasoning) {
    return;
  }

  const wireLevel = resolveWireLevel(reasoning);
  if (reasoning.control.wireProfile.kind === 'gemini-thinking-level') {
    if (!wireLevel) {
      return;
    }
    const thinkingLevel = reasoning.control.wireProfile.levels[wireLevel];
    if (thinkingLevel) {
      generationConfig.thinkingConfig = { thinkingLevel };
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
      generationConfig.thinkingConfig = { thinkingBudget };
    }
  }
}

export function applyGoogleInteractionsReasoning(
  generationConfig: Record<string, unknown>,
  reasoning: ResolvedReasoningSelection | undefined,
  reasoningVisibility?: ReasoningVisibility,
): void {
  if (!reasoning || reasoning.control.wireProfile.kind !== 'gemini-thinking-level') return;
  const wireLevel = resolveWireLevel(reasoning);
  if (!wireLevel) return;
  const thinkingLevel = reasoning.control.wireProfile.levels[wireLevel];
  if (!thinkingLevel) return;
  generationConfig.thinking_level = thinkingLevel;
  if (reasoningVisibility === 'summary-events') generationConfig.thinking_summaries = 'auto';
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
  reasoningVisibility?: ReasoningVisibility,
): void {
  if (!reasoning) {
    return;
  }
  if (reasoning.control.wireProfile.kind === 'moonshot-thinking') {
    applyMoonshotReasoning(body, reasoning);
    return;
  }
  applyAnthropicReasoning(body, reasoning, reasoningVisibility);
}
