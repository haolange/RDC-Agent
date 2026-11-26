import { describe, expect, it, vi } from 'vitest';
import { RuntimePermissionStateService } from './RuntimePermissionStateService';

describe('RuntimePermissionStateService', () => {
  it('keeps a committed mode and the other listeners when one listener fails, and reports the failure', () => {
    const service = new RuntimePermissionStateService();
    service.initialize('default');
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const seen: string[] = [];
    service.subscribe(() => { throw new Error('listener broke'); });
    service.subscribe((state) => seen.push(state.mode));
    try {
      expect(service.commitMode('full-access').mode).toBe('full-access');
      expect(seen).toEqual(['full-access']);
      expect(report).toHaveBeenCalledWith('[main] Permission mode listener failed:', expect.objectContaining({ message: 'listener broke' }));
    } finally {
      report.mockRestore();
    }
  });
});
