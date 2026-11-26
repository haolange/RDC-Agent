import { afterEach, describe, expect, it } from 'vitest';
import {
  adoptPreviousInstanceDiagnosis,
  diagnosePreviousInstance,
  interruptionCauseAt,
  interruptionCauseOf,
  previousInstanceNotice,
  type PreviousInstanceInput,
} from './previousInstanceDiagnosis';
import type { LifecycleEvent, LifecycleRecord } from './LifecycleLedger';
import type { PreviousInstanceClassification } from '@shared/types/lifecycle';

const START = Date.parse('2026-11-26T10:00:00.000Z');
const at = (offsetMs: number) => new Date(START + offsetMs).toISOString();
const record = (offsetMs: number, event: LifecycleEvent, instanceId = 'previous'): LifecycleRecord =>
  ({ ...event, at: at(offsetMs), instanceId }) as LifecycleRecord;
const started = record(0, {
  kind: 'instance_started',
  pid: 4242,
  birth: 'b',
  appVersion: '1',
  electronVersion: '42',
  mode: 'desktop',
});
const owner = { pid: 4242, birth: 'b', mode: 'desktop' as const, startTs: at(0), instanceId: 'previous' };
const input = (records: LifecycleRecord[], dumpOffsets: number[] = []): PreviousInstanceInput => ({
  staleOwner: owner,
  currentInstanceId: 'current',
  records: [started, ...records],
  damagedRecords: 0,
  crashDumps: dumpOffsets.map((offset, index) => ({ path: `d${index}.dmp`, mtimeMs: START + offset, size: 1 })),
});
const fault = (offset: number) =>
  record(offset, { kind: 'fault', fault: 'uncaughtException', message: 'boom', stackHash: '0123456789abcdef' });
const gone = (offset: number, process: 'renderer' | 'gpu') =>
  record(offset, { kind: 'process_gone', process, reason: 'crashed', exitCode: 139 });
const shutdownBegan = (offset: number) => record(offset, { kind: 'shutdown_began', cause: 'window-close' });

describe('previous launch classification', () => {
  afterEach(() => adoptPreviousInstanceDiagnosis(null));

  it.each<[string, PreviousInstanceInput, PreviousInstanceClassification]>([
    ['nothing was recorded', input([]), 'killed-or-power-loss-suspected'],
    ['an uncaught exception is the last fact', input([fault(10)]), 'js-fatal'],
    ['an unhandled rejection does not end a launch', input([]), 'killed-or-power-loss-suspected'],
    ['a minidump no child death explains', input([], [20]), 'native-crash-suspected'],
    ['a minidump explained by a renderer death', input([gone(20, 'renderer')], [21]), 'renderer-gone'],
    ['a minidump older than the launch', input([], [-60_000]), 'killed-or-power-loss-suspected'],
    ['a GPU process died last', input([fault(5), gone(30, 'gpu')]), 'child-process-gone'],
    ['a shutdown began and never exited', input([gone(5, 'renderer'), shutdownBegan(40)]), 'shutdown-interrupted'],
    ['an exception after a renderer death', input([gone(5, 'renderer'), fault(50)]), 'js-fatal'],
  ])('%s', (_name, value, expected) => {
    expect(diagnosePreviousInstance(value).classification).toBe(expected);
  });

  it('collects the evidence the notice copies: process, reason, last record and unfinished turns', () => {
    const turn = (offset: number, turnId: string) =>
      record(offset, { kind: 'turn_started', sessionId: 's', turnId, runId: null, providerId: 'p', modelId: 'm' });
    const diagnosis = diagnosePreviousInstance(
      input([
        turn(1, 'done'),
        record(2, { kind: 'turn_finished', sessionId: 's', turnId: 'done', status: 'complete' }),
        turn(3, 'open'),
        gone(4, 'renderer'),
        record(
          5,
          { kind: 'turn_started', sessionId: 'x', turnId: 'other', runId: null, providerId: 'p', modelId: 'm' },
          'older',
        ),
      ]),
    );
    expect(diagnosis).toMatchObject({
      classification: 'renderer-gone',
      instanceId: 'previous',
      pid: 4242,
      startedAt: START,
      lastRecord: 'process_gone',
      lastRecordAt: START + 4,
      process: 'renderer',
      reason: 'crashed',
      exitCode: 139,
      interruptedTurns: [{ sessionId: 's', turnId: 'open' }],
    });
  });

  it('finds the previous launch in the ledger when its lock recorded no instance id', () => {
    const diagnosis = diagnosePreviousInstance({
      ...input([fault(10)]),
      staleOwner: { pid: 0, birth: '', mode: 'unknown', startTs: 'unknown', instanceId: '' },
    });
    expect(diagnosis).toMatchObject({ instanceId: 'previous', classification: 'js-fatal', startedAt: START });
  });

  it('attributes records to the diagnosed launch only between its start and this launch', () => {
    const diagnosis = diagnosePreviousInstance(input([fault(10)]));
    adoptPreviousInstanceDiagnosis(diagnosis, START + 60_000);
    expect(interruptionCauseAt(START + 30)).toBe('js-fatal');
    expect(interruptionCauseAt(START - 1)).toBe('unknown');
    expect(interruptionCauseAt(START + 60_000)).toBe('unknown');
    expect(interruptionCauseOf('previous')).toBe('js-fatal');
    expect(interruptionCauseOf('older')).toBe('unknown');
    expect(previousInstanceNotice()).not.toHaveProperty('damagedRecords');
  });
});
