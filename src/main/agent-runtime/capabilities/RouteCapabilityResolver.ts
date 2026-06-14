import type {
  AgentRouteCapability,
  ReasoningVisibility,
  ToolCallingMode,
} from '@shared/types/agentRuntime';
import type {
  LlmProviderCapability,
  LlmProviderEntry,
  LlmProviderId,
  LlmProviderKind,
} from '@shared/types/settings';

const NATIVE_TOOL_PROVIDER_KINDS = new Set<LlmProviderKind>([
  'anthropic',
  'openai-compatible',
  'openrouter',
  'azure-openai',
  'google-ai-studio',
  'ollama',
]);

const STREAMING_PROVIDER_KINDS = new Set<LlmProviderKind>([
  'anthropic',
  'openai-compatible',
  'openrouter',
  'azure-openai',
  'google-ai-studio',
  'ollama',
]);

function hasCapability(
  provider: LlmProviderEntry | undefined,
  capability: LlmProviderCapability,
): boolean {
  return Boolean(provider?.capabilities?.includes(capability));
}

function resolveReasoningVisibility(provider: LlmProviderEntry | undefined): ReasoningVisibility {
  if (!provider) return 'none';
  return hasCapability(provider, 'reasoning') ? 'summary-events' : 'none';
}

function disabledCapability(providerId: LlmProviderId, modelId: string): AgentRouteCapability {
  return {
    providerId,
    modelId,
    toolCallingMode: 'disabled',
    reasoningVisibility: 'none',
    supportsStreaming: false,
    supportsToolResults: false,
  };
}

export function resolveAgentRouteCapability(
  provider: LlmProviderEntry | undefined,
  modelId: string,
): AgentRouteCapability {
  const providerId = provider?.id ?? '';
  if (!provider || !provider.enabled || !provider.isConfigured || provider.status !== 'verified') {
    return disabledCapability(providerId, modelId);
  }

  if (!hasCapability(provider, 'chat')) {
    return disabledCapability(provider.id, modelId);
  }

  const supportsStreaming = STREAMING_PROVIDER_KINDS.has(provider.kind);
  const runtimeHasNativeTools = NATIVE_TOOL_PROVIDER_KINDS.has(provider.kind);
  let toolCallingMode: ToolCallingMode = 'text-only';
  if (hasCapability(provider, 'tool-calling') && runtimeHasNativeTools) {
    toolCallingMode = 'native-structured';
  } else if (!supportsStreaming) {
    toolCallingMode = 'disabled';
  }

  return {
    providerId: provider.id,
    modelId,
    toolCallingMode,
    reasoningVisibility: resolveReasoningVisibility(provider),
    supportsStreaming,
    supportsToolResults: toolCallingMode === 'native-structured',
  };
}

export function describeRouteCapabilityDiagnostic(
  capability: AgentRouteCapability,
  availableToolCount: number,
): string | null {
  if (availableToolCount <= 0 || capability.toolCallingMode === 'native-structured') {
    return null;
  }

  if (capability.toolCallingMode === 'disabled') {
    return `Current route ${capability.providerId}/${capability.modelId} is not available for structured agent tools. Tools were not registered and no textual tool calls will be executed.`;
  }

  return `Current route ${capability.providerId}/${capability.modelId} is text-only for agent tools. Tools were not registered and textual tool calls will not be executed.`;
}

