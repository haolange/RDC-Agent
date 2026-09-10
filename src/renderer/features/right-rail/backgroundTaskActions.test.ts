import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stopBackgroundWork } from './backgroundTaskActions';

describe('stopBackgroundWork', () => {
  const cancelActiveTurn = vi.fn();
  beforeEach(() => {
    cancelActiveTurn.mockReset();
    vi.stubGlobal('window', { electronAPI: { conversation: { cancelActiveTurn } } });
  });
  it('reports an unsuccessful session-wide stop', async () => {
    cancelActiveTurn.mockResolvedValue({ success: false, error: 'cleanup not confirmed' });
    await expect(stopBackgroundWork('session')).rejects.toThrow('cleanup not confirmed');
  });
  it('propagates IPC rejection', async () => {
    cancelActiveTurn.mockRejectedValue(new Error('transport failed'));
    await expect(stopBackgroundWork('session')).rejects.toThrow('transport failed');
  });
});
