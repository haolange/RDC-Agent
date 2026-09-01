/**
 * Same-turn tool dispatch: consecutive concurrency-safe groups run in parallel;
 * unsafe calls are exclusive. Budget is reserved atomically before a group starts.
 * Partial failure does not cancel already-dispatched calls in the same group,
 * but later groups are not opened. Abort joins with allSettled.
 */

import { partitionConsecutiveSafeGroups } from './toolConcurrency';

export interface ConcurrentDispatchReservation {
  ok: true;
}

export interface ConcurrentDispatchReservationFailure {
  ok: false;
  limit: string;
}

export type ConcurrentDispatchReserveResult =
  | ConcurrentDispatchReservation
  | ConcurrentDispatchReservationFailure;

export interface ConcurrentToolSchedulerInput<TCall, TResult> {
  calls: readonly TCall[];
  isSafe: (call: TCall, index: number) => boolean;
  reserve: (group: readonly TCall[]) => ConcurrentDispatchReserveResult;
  executeOne: (call: TCall, index: number) => Promise<TResult>;
  createBudgetFailure: (call: TCall, index: number, limit: string) => TResult;
  createNotStarted: (call: TCall, index: number, reason: string) => TResult;
  isErrorResult?: (result: TResult) => boolean;
  signal?: AbortSignal;
}

export async function executeConcurrentToolGroups<TCall, TResult>(
  input: ConcurrentToolSchedulerInput<TCall, TResult>,
): Promise<TResult[]> {
  const results: Array<TResult | undefined> = new Array(input.calls.length);
  const groups = partitionConsecutiveSafeGroups(
    input.calls.map((call, index) => input.isSafe(call, index)),
  );
  let stopNewGroups = false;

  const fillRange = (
    indexes: readonly number[],
    factory: (call: TCall, index: number) => TResult,
  ) => {
    for (const index of indexes) {
      if (results[index] === undefined) {
        results[index] = factory(input.calls[index], index);
      }
    }
  };

  const remainingIndexesFrom = (groupIndex: number): number[] => {
    const indexes: number[] = [];
    for (let i = groupIndex; i < groups.length; i += 1) {
      indexes.push(...groups[i].callIndexes);
    }
    return indexes;
  };

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex];
    const groupCalls = group.callIndexes.map((index) => input.calls[index]);

    if (input.signal?.aborted) {
      fillRange(remainingIndexesFrom(groupIndex), (call, index) => (
        input.createNotStarted(call, index, 'aborted before dispatch')
      ));
      break;
    }
    if (stopNewGroups) {
      fillRange(group.callIndexes, (call, index) => (
        input.createNotStarted(call, index, 'prior group failed')
      ));
      continue;
    }

    const reservation = input.reserve(groupCalls);
    if (!reservation.ok) {
      fillRange(group.callIndexes, (call, index) => (
        input.createBudgetFailure(call, index, reservation.limit)
      ));
      stopNewGroups = true;
      continue;
    }

    const started = group.callIndexes.map((index) => input.executeOne(input.calls[index], index));
    const settled = await Promise.allSettled(started);
    let groupFailed = false;
    settled.forEach((entry, offset) => {
      const index = group.callIndexes[offset];
      if (entry.status === 'fulfilled') {
        results[index] = entry.value;
        if (input.isErrorResult?.(entry.value) === true) {
          groupFailed = true;
        }
      } else {
        groupFailed = true;
        const message = entry.reason instanceof Error ? entry.reason.message : String(entry.reason);
        results[index] = input.createNotStarted(input.calls[index], index, message);
      }
    });
    if (groupFailed || input.signal?.aborted) {
      stopNewGroups = true;
    }
  }

  return results.map((result, index) => (
    result ?? input.createNotStarted(input.calls[index], index, 'missing result')
  ));
}
