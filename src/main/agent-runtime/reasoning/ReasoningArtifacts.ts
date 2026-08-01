import type { ThinkingArtifact as SharedThinkingArtifact } from '@shared/types/reasoning';
import type {
  ProviderContinuationArtifact,
  ThinkingArtifactKind,
  ThinkingArtifactSource,
  ThinkingArtifactVisibility,
  ThinkingContent,
} from '../core/types';
import { normalizeContinuationArtifact, toContinuationMetadata } from './ContinuationArtifacts';

export interface ThinkingContentInput {
  text?: string;
  kind?: ThinkingArtifactKind;
  source?: ThinkingArtifactSource;
  visibility?: ThinkingArtifactVisibility;
  continuation?: ProviderContinuationArtifact;
}

const DEFAULT_KIND: ThinkingArtifactKind = 'raw';
const DEFAULT_SOURCE: ThinkingArtifactSource = 'unknown';
const DEFAULT_VISIBILITY: ThinkingArtifactVisibility = 'raw-collapsed';

export function createThinkingContent(input: ThinkingContentInput = {}): ThinkingContent {
  const text = input.text?.trim();
  const kind = input.kind ?? (input.continuation && !text ? 'opaque' : DEFAULT_KIND);
  return {
    type: 'thinking',
    ...(text ? { text } : {}),
    kind,
    source: input.source ?? DEFAULT_SOURCE,
    visibility: input.visibility ?? defaultVisibility(kind),
    ...(input.continuation ? { continuation: input.continuation } : {}),
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
  const text = (thinking.text ?? '') + delta;
  return {
    ...thinking,
    ...(text ? { text } : { text: undefined }),
  };
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
    ...(patch.continuation ? { continuation: patch.continuation } : {}),
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
    continuation: normalizeContinuationArtifact(record.continuation),
  });
}

export function toSharedThinkingArtifact(thinking: ThinkingContent): SharedThinkingArtifact {
  return {
    text: thinking.text,
    kind: thinking.kind,
    source: thinking.source,
    visibility: thinking.visibility,
    continuation: toContinuationMetadata(thinking.continuation),
    providerOutputRef: thinking.providerOutputRef ? { ...thinking.providerOutputRef } : undefined,
  };
}

function defaultVisibility(kind: ThinkingArtifactKind): ThinkingArtifactVisibility {
  if (kind === 'summary') return 'summary';
  if (kind === 'opaque') return 'hidden';
  return DEFAULT_VISIBILITY;
}

const isThinkingKind = (value: unknown): value is ThinkingArtifactKind => (
  value === 'summary' || value === 'raw' || value === 'opaque' || value === 'unknown'
);

const isThinkingVisibility = (value: unknown): value is ThinkingArtifactVisibility => (
  value === 'summary' || value === 'raw-collapsed' || value === 'hidden'
);

const isThinkingSource = (value: unknown): value is ThinkingArtifactSource => (
  value === 'openai-responses-summary'
  || value === 'openai-responses-encrypted'
  || value === 'xai-responses-summary'
  || value === 'xai-responses-encrypted'
  || value === 'anthropic-thinking'
  || value === 'anthropic-redacted-thinking'
  || value === 'openai-compatible-raw'
  || value === 'openrouter-raw'
  || value === 'deepseek-raw'
  || value === 'kimi-raw'
  || value === 'glm-raw'
  || value === 'qwen-raw'
  || value === 'gemini-summary'
  || value === 'gemini-thought-signature'
  || value === 'ollama-raw'
  || value === 'unknown'
);
