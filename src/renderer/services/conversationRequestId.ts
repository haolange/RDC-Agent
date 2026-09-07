export function createConversationRequestId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `request-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
