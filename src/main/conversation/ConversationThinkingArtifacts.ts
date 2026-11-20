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
