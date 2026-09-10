import { describe, expect, it } from 'vitest';
import { MaterialContextSchema } from './materialContext';
describe('material locations', () => {
  it('rejects out-of-image areas, inverted time ranges and incomplete comparison conditions', () => {
    expect(MaterialContextSchema.safeParse({ region: { x: 0.9, y: 0, width: 0.2, height: 1 } }).success).toBe(false);
    expect(MaterialContextSchema.safeParse({ timeRange: { startSeconds: 10, endSeconds: 2 } }).success).toBe(false);
    expect(MaterialContextSchema.safeParse({ comparison: { group: 'eye', role: 'after', conditions: '' } }).success).toBe(false);
  });
});
