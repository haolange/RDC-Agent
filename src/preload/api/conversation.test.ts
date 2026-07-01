import { beforeEach, describe, expect, it, vi } from 'vitest';

const ipcRendererMock = {
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  removeAllListeners: vi.fn(),
};

vi.mock('electron', () => ({
  ipcRenderer: ipcRendererMock,
}));

describe('createConversationApi listeners', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('removes conversation:event with the same callback identity used for registration', async () => {
    const { createConversationApi } = await import('./conversation');
    const api = createConversationApi();
    const callback = vi.fn();

    api.onEvent(callback);
    const wrappedCallback = ipcRendererMock.on.mock.calls[0]?.[1];
    expect(typeof wrappedCallback).toBe('function');

    wrappedCallback({}, { type: 'message_patched' });
    expect(callback).toHaveBeenCalledWith({ type: 'message_patched' });

    api.offEvent(callback);
    expect(ipcRendererMock.removeListener).toHaveBeenCalledWith('conversation:event', wrappedCallback);
  });
});
