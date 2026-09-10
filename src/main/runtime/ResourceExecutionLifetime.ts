import { AsyncLocalStorage } from 'node:async_hooks';

const activeLifetime = new AsyncLocalStorage<Set<Promise<unknown>>>();

/** Keep the current tool resource claim until the supervisor observes exit. */
export function retainResourceUntilExit(exit: Promise<unknown>): void {
  activeLifetime.getStore()?.add(exit);
}

export async function withResourceLifetime<T>(retained: Set<Promise<unknown>>, operation: () => Promise<T>): Promise<T> {
  const parent = activeLifetime.getStore();
  try { return await activeLifetime.run(retained, operation); }
  finally { if (parent) for (const exit of retained) parent.add(exit); }
}

const executionOwner = new AsyncLocalStorage<string>();
export function withProcessExecutionOwner<T>(sessionId: string | null | undefined, operation: () => Promise<T>): Promise<T> {
  return sessionId ? executionOwner.run(sessionId, operation) : operation();
}
export function currentProcessExecutionOwner(): string | undefined { return executionOwner.getStore(); }
