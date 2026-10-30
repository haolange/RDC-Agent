import type { RuntimePermissionState } from '@shared/types/runtimePermission';
import type { AgentPermissionDecision } from './AgentPermissionPolicy';
import { PermissionModeChangedError, runtimePermissionStateService, type RuntimePermissionStateService } from './RuntimePermissionStateService';

/** A retry stays internal: no result, hook, dispatch budget or effect is repeated. */
const stale = Symbol('permission-revision-stale');

export interface PermissionAdmissionInput<T> {
  authorize: (state: RuntimePermissionState, signal: AbortSignal) => Promise<AgentPermissionDecision>;
  beforeExecute: () => Promise<void>;
  withResource: (operation: () => Promise<T | typeof stale>) => Promise<T | typeof stale>;
  execute: (decision: AgentPermissionDecision, state: RuntimePermissionState) => Promise<T>;
  assertLive: () => void;
  signal?: AbortSignal;
  state?: RuntimePermissionStateService;
}

export async function executeWithPermissionAdmission<T>(input: PermissionAdmissionInput<T>): Promise<T> {
  const authority = input.state ?? runtimePermissionStateService;
  let hookCompleted = false;
  for (;;) {
    input.signal?.throwIfAborted();
    input.assertLive();
    const snapshot = authority.getSnapshot();
    const controller = new AbortController();
    const abort = () => controller.abort(input.signal?.reason);
    input.signal?.addEventListener('abort', abort, { once: true });
    const unsubscribe = authority.subscribe(() => controller.abort(new PermissionModeChangedError()));
    let decision: AgentPermissionDecision;
    try {
      decision = await input.authorize(snapshot, controller.signal);
    } catch (error) {
      if (error instanceof PermissionModeChangedError && !input.signal?.aborted) continue;
      throw error;
    } finally {
      unsubscribe();
      input.signal?.removeEventListener('abort', abort);
    }
    if (!hookCompleted) {
      await input.beforeExecute();
      hookCompleted = true;
    }
    const result = await input.withResource(() => {
      input.signal?.throwIfAborted();
      input.assertLive();
      if (authority.getSnapshot().revision !== snapshot.revision) return Promise.resolve(stale);
      // No await or observer runs between version validation and admission.
      // The snapshot/decision are consumed once by this invocation. The
      // callback announces the committed admission before invoking the effect.
      return input.execute(decision, snapshot);
    });
    if (result !== stale) return result;
  }
}
