import { describe, expect, it, vi } from 'vitest';
import type { CaptureReplayHistoryEntry } from '@shared/types/captureReplay';
import { CaptureHistory } from './CaptureHistory';
import { latestSuccessfulHistoryIndex, readCaptureHistory } from './readCaptureHistory';

const entry = (sequence: number, summary: string): CaptureReplayHistoryEntry => ({ sequence, summary, eventId: 1, operationId: summary, timestamp: 0, saved: true });
describe('capture history identity isolation', () => {
  it('follows the latest successful Agent image while preserving failure steps for scrubbing', () => {
    const entries = [{ ...entry(1, 'success'), imageSha256: 'image' }, { ...entry(2, 'failure'), failure: 'export failed' }];
    expect(latestSuccessfulHistoryIndex(entries)).toBe(0);
    expect(entries[1].failure).toBe('export failed');
    expect(latestSuccessfulHistoryIndex([entries[1]])).toBe(0);
    expect(latestSuccessfulHistoryIndex([])).toBe(-1);
  });
  it('remounts all history state for every scope or capture change, including absent hash', () => {
    const props = { scope: { projectId: 'p', sessionId: 's' }, captureHash: 'a', state: null, active: true };
    const original = CaptureHistory(props).key;
    expect(CaptureHistory({ ...props }).key).toBe(original);
    for (const changed of [{ ...props, captureHash: 'b' }, { ...props, captureHash: null }, { ...props, scope: { projectId: 'p', sessionId: 't' } }, { ...props, scope: { projectId: 'q', sessionId: 's' } }]) {
      expect(CaptureHistory(changed).key).not.toBe(original);
    }
  });
  it.each([1, 7])('reads another capture from the beginning even when its sequence is %i', async (sequence) => {
    const first = await readCaptureHistory([], async () => ({ entries: [entry(7, 'first')] }), () => true);
    const nextPage = vi.fn().mockResolvedValue({ entries: [entry(sequence, 'second')] });
    const second = await readCaptureHistory([], nextPage, () => true);
    expect(nextPage).toHaveBeenCalledWith(undefined);
    expect(first?.[0].summary).toBe('first');
    expect(second).toEqual([entry(sequence, 'second')]);
  });
  it('discards a late response after its owning capture is unmounted', async () => {
    let current = true;
    let resolve!: (page: { entries: CaptureReplayHistoryEntry[] }) => void;
    const pending = readCaptureHistory([], () => new Promise((done) => { resolve = done; }), () => current);
    current = false;
    resolve({ entries: [entry(1, 'old')] });
    expect(await pending).toBeNull();
  });
});
