/**
 * Concurrency of same-turn tool calls, read from the concurrency class each tool declares.
 * A call without a resolved tool is unsafe. Delegated resource admission and child
 * effects enforce their own resource claims.
 */

import type { AgentToolSpec } from './AgentTool';

/** Whether a call may join a consecutive parallel group. Missing spec → unsafe. */
export function isConcurrencySafeSpec(spec: AgentToolSpec | undefined): boolean {
  return spec?.concurrency === 'shared' || spec?.concurrency === 'orchestration-parallel';
}

/** The project resource claim a call's effect takes; orchestration takes none. */
export function resourceClaimOf(spec: AgentToolSpec): 'none' | 'shared' | 'exclusive' {
  switch (spec.concurrency) {
    case 'orchestration-parallel':
    case 'orchestration-serial':
      return 'none';
    case 'shared':
      return 'shared';
    case 'exclusive':
      return 'exclusive';
  }
}

export interface ConcurrentToolGroup {
  /** Original call indexes in stable order. */
  callIndexes: number[];
  parallel: boolean;
}

/** Partition a same-turn call list into consecutive safe groups and exclusive unsafe singles. */
export function partitionConsecutiveSafeGroups(safeFlags: readonly boolean[]): ConcurrentToolGroup[] {
  const groups: ConcurrentToolGroup[] = [];
  let current: ConcurrentToolGroup | null = null;
  for (let index = 0; index < safeFlags.length; index += 1) {
    const safe = safeFlags[index] === true;
    if (safe) {
      if (current && current.parallel) {
        current.callIndexes.push(index);
      } else {
        current = { callIndexes: [index], parallel: true };
        groups.push(current);
      }
      continue;
    }
    current = { callIndexes: [index], parallel: false };
    groups.push(current);
  }
  return groups;
}

/** Number of calls whose tool declares that it dispatches a subagent. */
export function countSubagentDispatches(specs: ReadonlyArray<AgentToolSpec | undefined>): number {
  return specs.reduce((sum, spec) => (spec?.dispatchesSubagent === true ? sum + 1 : sum), 0);
}
