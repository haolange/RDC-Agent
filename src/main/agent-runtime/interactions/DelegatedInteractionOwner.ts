import { AsyncLocalStorage } from 'node:async_hooks';

export interface DelegatedInteractionOwner { ownerSessionId: string; childSessionId: string; executionId: string }
const ownerContext = new AsyncLocalStorage<DelegatedInteractionOwner>();

export function withDelegatedInteractionOwner<T>(input: DelegatedInteractionOwner, operation: () => Promise<T>): Promise<T> {
  const ancestor = ownerContext.getStore();
  const ownerSessionId = ancestor?.childSessionId === input.ownerSessionId ? ancestor.ownerSessionId : input.ownerSessionId;
  return ownerContext.run({ ...input, ownerSessionId }, operation);
}
export function getDelegatedInteractionOwner(sessionId: string | null | undefined): DelegatedInteractionOwner | undefined {
  const owner = ownerContext.getStore();
  return owner?.childSessionId === sessionId ? owner : undefined;
}
