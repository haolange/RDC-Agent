/** All UI and Agent operations for a native context share this queue. */
const queues = new Map<string, Promise<unknown>>();
const locks = new Map<string, Set<string>>();
const listeners = new Set<(sessionId: string) => void>();
const lifecycles = new Map<string, number>();
export function beginRdxLifecycle(sessionId: string): () => void {
  lifecycles.set(sessionId, (lifecycles.get(sessionId) ?? 0) + 1);
  return () => {
    const remaining = (lifecycles.get(sessionId) ?? 1) - 1;
    if (remaining) lifecycles.set(sessionId, remaining); else lifecycles.delete(sessionId);
  };
}
export function acquireRdxPreparationLock(sessionId: string, owner: string): void {
  if (lifecycles.has(sessionId)) throw new Error('RDX_REPLAY_BUSY: wait for capture lifecycle completion.');
  setRdxInteractionLock(sessionId, owner, true);
}
export function runRdxOperation<T>(contextId: string, operation: () => Promise<T>): Promise<T> {
  const previous = queues.get(contextId) ?? Promise.resolve();
  const pending = previous.catch(() => undefined).then(operation);
  queues.set(contextId, pending);
  void pending.finally(() => { if (queues.get(contextId) === pending) queues.delete(contextId); }).catch(() => undefined);
  return pending;
}
export function setRdxInteractionLock(sessionId: string, owner: string, locked: boolean): void {
  const entries = locks.get(sessionId) ?? new Set<string>();
  if (locked) entries.add(owner); else entries.delete(owner);
  if (entries.size) locks.set(sessionId, entries); else locks.delete(sessionId);
  for (const listener of listeners) listener(sessionId);
}
export function getRdxInteractionLock(sessionId: string): string | null {
  return locks.get(sessionId)?.size ? 'agent_running' : null;
}
export function subscribeRdxInteractionLock(listener: (sessionId: string) => void): () => void {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
