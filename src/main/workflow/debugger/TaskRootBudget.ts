import type { TaskRegistry } from '../../agent-runtime/tasks';
import { policyBudgetChain, registerPolicyBudgetObserver } from './DelegationBudget';
import type { PolicyBudgetState } from './TurnCoordinator';

interface RootBindingState {
  rootBudgetId: string;
  observers: Map<string, () => void>;
}

const bindings = new WeakMap<PolicyBudgetState, RootBindingState>();
const bindingQueues = new WeakMap<PolicyBudgetState, Promise<void>>();

/** Stable for every child ledger derived from one root policy budget. */
export function taskRootBudgetId(policyBudget: PolicyBudgetState): string {
  return `policy:${policyBudget.wallStartedAt}`;
}

export async function bindTaskRootBudget(
  registry: TaskRegistry,
  ownerSessionId: string,
  policyBudget: PolicyBudgetState,
  existingRootBudgetId?: string,
): Promise<string> {
  const rootPolicyBudget = policyBudgetChain(policyBudget).at(-1) ?? policyBudget;
  return withBindingLock(rootPolicyBudget, async () => bindRootBudgetLocked(
    registry,
    ownerSessionId,
    rootPolicyBudget,
    existingRootBudgetId,
  ));
}

async function bindRootBudgetLocked(
  registry: TaskRegistry,
  ownerSessionId: string,
  rootPolicyBudget: PolicyBudgetState,
  existingRootBudgetId?: string,
): Promise<string> {
  const state = bindings.get(rootPolicyBudget);
  const id = existingRootBudgetId ?? state?.rootBudgetId ?? taskRootBudgetId(rootPolicyBudget);
  if (state && state.rootBudgetId !== id) {
    throw new Error('TASK_ROOT_BUDGET_REBIND_DENIED: a live policy ledger already has a different durable root.');
  }
  const durable = await registry.getRootBudget(id);
  const observers = state?.observers ?? new Map<string, () => void>();
  const alreadyBound = observers.has(ownerSessionId);
  if (durable) {
    // A fresh in-memory ledger after restart/continuation contains only new
    // reservations. Merge them once; repeated binds of the same live ledger
    // must not charge those reservations again.
    if (!alreadyBound) {
      rootPolicyBudget.toolCalls += durable.toolCalls;
      rootPolicyBudget.subagents += durable.subagents;
    } else {
      rootPolicyBudget.toolCalls = Math.max(rootPolicyBudget.toolCalls, durable.toolCalls);
      rootPolicyBudget.subagents = Math.max(rootPolicyBudget.subagents, durable.subagents);
    }
    rootPolicyBudget.maxToolCalls = Math.min(rootPolicyBudget.maxToolCalls, durable.maxToolCalls);
    rootPolicyBudget.maxSubagents = Math.min(rootPolicyBudget.maxSubagents, durable.maxSubagents);
    rootPolicyBudget.maxChildDepth = Math.min(rootPolicyBudget.maxChildDepth, durable.maxChildDepth);
    rootPolicyBudget.wallStartedAt = Math.min(rootPolicyBudget.wallStartedAt, durable.startedAt);
    rootPolicyBudget.maxWallTimeMs = Math.min(
      rootPolicyBudget.maxWallTimeMs,
      Math.max(0, durable.deadlineAt - rootPolicyBudget.wallStartedAt),
    );
  }
  const persist = (snapshot: PolicyBudgetState) => registry.updateRootBudget(id, {
    toolCalls: snapshot.toolCalls,
    subagents: snapshot.subagents,
    maxToolCalls: snapshot.maxToolCalls,
    maxSubagents: snapshot.maxSubagents,
    maxChildDepth: snapshot.maxChildDepth,
    deadlineAt: snapshot.wallStartedAt + snapshot.maxWallTimeMs,
    startedAt: snapshot.wallStartedAt,
  }).then(() => undefined);
  await persist(rootPolicyBudget);
  if (!alreadyBound) observers.set(ownerSessionId, registerPolicyBudgetObserver(rootPolicyBudget, persist));
  bindings.set(rootPolicyBudget, { rootBudgetId: id, observers });
  return id;
}

async function withBindingLock<T>(budget: PolicyBudgetState, action: () => Promise<T>): Promise<T> {
  const previous = bindingQueues.get(budget) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => current);
  bindingQueues.set(budget, tail);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (bindingQueues.get(budget) === tail) bindingQueues.delete(budget);
  }
}
