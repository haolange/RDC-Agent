import { describe, expect, it } from 'vitest';
import { isWithinSessionCompactionLine } from './CompactionHandoffService';

describe('session compaction line', () => {
  it('treats occupancy at or below the threshold as a no-op', () => {
    expect(isWithinSessionCompactionLine(100_000, 160_000, 8)).toBe(true);
    expect(isWithinSessionCompactionLine(160_000, 160_000, 8)).toBe(true);
  });

  it('treats short histories as a no-op even when occupancy is over the line', () => {
    expect(isWithinSessionCompactionLine(180_000, 160_000, 3)).toBe(true);
  });

  it('requires a model-generated handoff once occupancy and turn count both exceed the line', () => {
    expect(isWithinSessionCompactionLine(180_000, 160_000, 4)).toBe(false);
  });
});
