export interface ProviderOutputRef {
  protocol: string;
  responseId?: string;
  providerBlockKey: string;
  sourceIndex?: number;
  itemId?: string;
  contentIndex: number;
}

export type ThinkingArtifactKind = 'summary' | 'raw' | 'opaque' | 'unknown';

export type ThinkingArtifactVisibility = 'summary' | 'raw-collapsed' | 'hidden';

export type ThinkingArtifactReplayPolicy = 'none' | 'provider-artifact' | 'openai-reasoning-content';

export type ThinkingArtifactSource =
  | 'openai-responses-summary'
  | 'openai-responses-encrypted'
  | 'anthropic-thinking'
  | 'anthropic-redacted-thinking'
  | 'openai-compatible-raw'
  | 'openrouter-raw'
  | 'gemini-raw'
  | 'ollama-raw'
  | 'unknown';

export interface ProviderReasoningArtifact {
  providerId: string;
  modelId?: string;
  protocol?: string;
  type: string;
  id?: string;
  encryptedContent?: string;
  signature?: string;
  data?: string;
  raw?: Record<string, unknown>;
}

export interface ThinkingArtifact {
  text?: string;
  kind: ThinkingArtifactKind;
  source: ThinkingArtifactSource;
  visibility: ThinkingArtifactVisibility;
  replayPolicy: ThinkingArtifactReplayPolicy;
  artifact?: ProviderReasoningArtifact;
  providerOutputRef?: ProviderOutputRef;
}
