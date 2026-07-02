import type { ThinkingArtifact as SharedThinkingArtifact } from '@shared/types/reasoning';
import type {
  ProviderReasoningArtifact,
  ThinkingArtifactKind,
  ThinkingArtifactReplayPolicy,
  ThinkingArtifactSource,
  ThinkingArtifactVisibility,
  ThinkingContent,
} from '../core/types';

export interface ThinkingContentInput {
  text?: string;
  kind?: ThinkingArtifactKind;
  source?: ThinkingArtifactSource;
  visibility?: ThinkingArtifactVisibility;
  replayPolicy?: ThinkingArtifactReplayPolicy;
  artifact?: ProviderReasoningArtifact;
}

const DEFAULT_KIND: ThinkingArtifactKind = 'raw';
const DEFAULT_SOURCE: ThinkingArtifactSource = 'unknown';
const DEFAULT_VISIBILITY: ThinkingArtifactVisibility = 'raw-collapsed';
const DEFAULT_REPLAY_POLICY: ThinkingArtifactReplayPolicy = 'none';

export function createThinkingContent(input: ThinkingContentInput = {}): ThinkingContent {
  const text = input.text?.trim();
  const kind = input.kind ?? (input.artifact && !text ? 'opaque' : DEFAULT_KIND);
  return {
    type: 'thinking',
    ...(text ? { text } : {}),
    kind,
    source: input.source ?? DEFAULT_SOURCE,
    visibility: input.visibility ?? defaultVisibility(kind),
    replayPolicy: input.replayPolicy ?? DEFAULT_REPLAY_POLICY,
    ...(input.artifact ? { artifact: input.artifact } : {}),
  };
}

export function withThinkingText(thinking: ThinkingContent, text: string): ThinkingContent {
  const nextText = text.trim();
  return {
    ...thinking,
    ...(nextText ? { text: nextText } : { text: undefined }),
  };
}

export function appendThinkingText(thinking: ThinkingContent, delta: string): ThinkingContent {
  if (!delta) return thinking;
  return withThinkingText(thinking, `${thinking.text ?? ''}${delta}`);
}

export function mergeThinkingContent(
  thinking: ThinkingContent,
  patch: ThinkingContentInput,
): ThinkingContent {
  return {
    ...thinking,
    ...(patch.text !== undefined ? { text: patch.text.trim() || undefined } : {}),
    ...(patch.kind ? { kind: patch.kind } : {}),
    ...(patch.source ? { source: patch.source } : {}),
    ...(patch.visibility ? { visibility: patch.visibility } : {}),
    ...(patch.replayPolicy ? { replayPolicy: patch.replayPolicy } : {}),
    ...(patch.artifact ? { artifact: patch.artifact } : {}),
  };
}

export function getThinkingText(thinking: Pick<ThinkingContent, 'text'> | null | undefined): string {
  return thinking?.text?.trim() ?? '';
}

export function normalizeThinkingContent(value: unknown): ThinkingContent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.type !== 'thinking') return null;
  const text = typeof record.text === 'string'
    ? record.text
    : typeof record.thinking === 'string'
      ? record.thinking
      : undefined;
  return createThinkingContent({
    text,
    kind: isThinkingKind(record.kind) ? record.kind : undefined,
    source: isThinkingSource(record.source) ? record.source : undefined,
    visibility: isThinkingVisibility(record.visibility) ? record.visibility : undefined,
    replayPolicy: isThinkingReplayPolicy(record.replayPolicy) ? record.replayPolicy : undefined,
    artifact: normalizeProviderArtifact(record.artifact),
  });
}

export function toSharedThinkingArtifact(thinking: ThinkingContent): SharedThinkingArtifact {
  return {
    text: thinking.text,
    kind: thinking.kind,
    source: thinking.source,
    visibility: thinking.visibility,
    replayPolicy: thinking.replayPolicy,
    artifact: thinking.artifact,
  };
}

function defaultVisibility(kind: ThinkingArtifactKind): ThinkingArtifactVisibility {
  if (kind === 'summary') return 'summary';
  if (kind === 'opaque') return 'hidden';
  return DEFAULT_VISIBILITY;
}

function normalizeProviderArtifact(value: unknown): ProviderReasoningArtifact | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const providerId = typeof record.providerId === 'string' ? record.providerId : '';
  const type = typeof record.type === 'string' ? record.type : '';
  if (!providerId || !type) return undefined;
  return {
    providerId,
    modelId: typeof record.modelId === 'string' ? record.modelId : undefined,
    protocol: typeof record.protocol === 'string' ? record.protocol : undefined,
    type,
    id: typeof record.id === 'string' ? record.id : undefined,
    encryptedContent: typeof record.encryptedContent === 'string' ? record.encryptedContent : undefined,
    signature: typeof record.signature === 'string' ? record.signature : undefined,
    data: typeof record.data === 'string' ? record.data : undefined,
    raw: record.raw && typeof record.raw === 'object' && !Array.isArray(record.raw)
      ? record.raw as Record<string, unknown>
      : undefined,
  };
}

const isThinkingKind = (value: unknown): value is ThinkingArtifactKind => (
  value === 'summary' || value === 'raw' || value === 'opaque'
);

const isThinkingVisibility = (value: unknown): value is ThinkingArtifactVisibility => (
  value === 'summary' || value === 'raw-collapsed' || value === 'hidden'
);

const isThinkingReplayPolicy = (value: unknown): value is ThinkingArtifactReplayPolicy => (
  value === 'none' || value === 'provider-artifact'
);

const isThinkingSource = (value: unknown): value is ThinkingArtifactSource => (
  value === 'openai-responses-summary'
  || value === 'openai-responses-encrypted'
  || value === 'anthropic-thinking'
  || value === 'anthropic-redacted-thinking'
  || value === 'openai-compatible-raw'
  || value === 'openrouter-raw'
  || value === 'gemini-raw'
  || value === 'ollama-raw'
  || value === 'unknown'
);
