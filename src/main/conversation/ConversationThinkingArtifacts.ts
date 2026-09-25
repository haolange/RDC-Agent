import type { ThinkingArtifact } from '@shared/types/reasoning';

export function cloneThinkingArtifact(thinking: ThinkingArtifact): ThinkingArtifact {
  return { ...thinking, continuation: thinking.continuation ? { ...thinking.continuation } : undefined };
}

export function mergeThinkingPayload(
  current: ThinkingArtifact | undefined,
  incoming: ThinkingArtifact | undefined,
  delta: string,
): ThinkingArtifact | undefined {
  if (incoming) {
    const incomingText = incoming.text ?? (delta ? `${current?.text ?? ''}${delta}` : current?.text);
    return cloneThinkingArtifact({ ...incoming, ...(incomingText ? { text: incomingText } : {}) });
  }
  if (!delta) return current;
  return cloneThinkingArtifact({
    ...(current ?? { kind: 'raw', source: 'unknown', visibility: 'raw-collapsed' }),
    text: `${current?.text ?? ''}${delta}`,
  });
}

export function selectCompletedThinking(thinking: ThinkingArtifact[] | undefined): ThinkingArtifact | undefined {
  if (!Array.isArray(thinking) || thinking.length === 0) return undefined;
  for (let index = thinking.length - 1; index >= 0; index -= 1) {
    const candidate = thinking[index];
    if (candidate.continuation || candidate.text) return cloneThinkingArtifact(candidate);
  }
  return undefined;
}
