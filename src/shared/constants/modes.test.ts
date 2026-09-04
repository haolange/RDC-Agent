import { describe, expect, it } from 'vitest';
import { assignDefaultCaptureRoles } from './modes';

describe('modes', () => {
  it('assignDefaultCaptureRoles maps primary/baseline/reference', () => {
    expect(assignDefaultCaptureRoles(0)).toEqual([]);
    expect(assignDefaultCaptureRoles(1)).toEqual(['primary']);
    expect(assignDefaultCaptureRoles(2)).toEqual(['primary', 'baseline']);
    expect(assignDefaultCaptureRoles(4)).toEqual(['primary', 'baseline', 'reference', 'reference']);
  });
});
