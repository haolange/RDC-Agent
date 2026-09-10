import type { DelegationCapsuleBudget } from '@shared/types/delegationCapsule';
import type { PolicyBudgetState } from './TurnCoordinator';

const parents = new WeakMap<PolicyBudgetState, PolicyBudgetState>();

/** Plain local ledger; parent ownership stays private and is never serialized as a second budget. */
export function deriveChildPolicyBudget(parent: PolicyBudgetState, requested: DelegationCapsuleBudget, restored?: PolicyBudgetState): PolicyBudgetState {
  const now = Date.now();
  if (restored && [restored.toolCalls, restored.subagents, restored.maxToolCalls, restored.maxSubagents, restored.wallStartedAt, restored.maxWallTimeMs, restored.childDepth, restored.maxChildDepth].some((value) => !Number.isFinite(value) || value < 0)) throw new Error('Invalid restored child budget.');
  const toolCalls = restored?.toolCalls ?? 0;
  const subagents = restored?.subagents ?? 0;
  const child: PolicyBudgetState = {
    toolCalls, subagents, reservedSubagentSlots: 0,
    childDepth: Math.max(parent.childDepth + 1, restored?.childDepth ?? 0),
    maxToolCalls: Math.min(requested.maxToolCalls, restored?.maxToolCalls ?? Infinity, toolCalls + Math.max(0, parent.maxToolCalls - parent.toolCalls)),
    maxSubagents: Math.min(requested.maxSubagents ?? parent.maxSubagents, restored?.maxSubagents ?? Infinity, subagents + Math.max(0, parent.maxSubagents - parent.subagents)),
    maxChildDepth: Math.min(parent.maxChildDepth, restored?.maxChildDepth ?? Infinity),
    wallStartedAt: parent.wallStartedAt,
    maxWallTimeMs: Math.min(parent.maxWallTimeMs, now - parent.wallStartedAt + requested.maxWallTimeMs, restored ? restored.wallStartedAt + restored.maxWallTimeMs - parent.wallStartedAt : Infinity),
  };
  parents.set(child, parent);
  return child;
}

export function policyBudgetChain(local: PolicyBudgetState): PolicyBudgetState[] {
  const chain: PolicyBudgetState[] = [];
  for (let current: PolicyBudgetState | undefined = local; current; current = parents.get(current)) chain.push(current);
  return chain;
}

interface DurableBudgetObserver {
  persist: (snapshot: PolicyBudgetState) => Promise<void>;
  pending: Promise<void>;
}
const durableObservers = new WeakMap<PolicyBudgetState, Set<DurableBudgetObserver>>();

/** Register main-owned durable accounting before the first provider/tool dispatch. */
export function registerPolicyBudgetObserver(ledger: PolicyBudgetState, persist: DurableBudgetObserver['persist']): () => void {
  const observers = durableObservers.get(ledger) ?? new Set<DurableBudgetObserver>();
  const observer = { persist, pending: Promise.resolve() };
  observers.add(observer); durableObservers.set(ledger, observers);
  return () => { observers.delete(observer); if (!observers.size) durableObservers.delete(ledger); };
}

/** A reserved cost must reach every durable ancestor before any external effect. */
export async function flushPolicyBudgetObservers(ledger?: PolicyBudgetState): Promise<void> {
  if (!ledger) return;
  const pending: Promise<void>[] = [];
  for (const current of policyBudgetChain(ledger)) {
    for (const observer of durableObservers.get(current) ?? []) {
      const snapshot = { ...current };
      // Keep reservation order. A failed write poisons this registration until explicit recovery.
      observer.pending = observer.pending.then(() => observer.persist(snapshot));
      pending.push(observer.pending);
    }
  }
  await Promise.all(pending);
}
