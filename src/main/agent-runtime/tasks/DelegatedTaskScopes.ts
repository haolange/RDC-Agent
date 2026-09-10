interface DelegatedTaskScope { ownerSessionId: string; rootTaskId: string; executionId?: string; generation?: number }
const scopes = new Map<string, DelegatedTaskScope>();

export function registerDelegatedTaskScope(childSessionId: string, scope: DelegatedTaskScope): () => void {
  scopes.set(childSessionId, scope);
  return () => { scopes.delete(childSessionId); };
}

export function getDelegatedTaskScope(childSessionId: string): DelegatedTaskScope | null {
  return scopes.get(childSessionId) ?? null;
}
