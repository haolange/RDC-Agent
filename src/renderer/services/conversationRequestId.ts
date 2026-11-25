export function createConversationRequestId(): string {
  return globalThis.crypto.randomUUID();
}
