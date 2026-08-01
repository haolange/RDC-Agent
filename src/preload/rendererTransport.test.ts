import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRendererApi } from '@shared/renderer-api';

const ipcRendererMock = {
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  removeAllListeners: vi.fn(),
};

vi.mock('electron', () => ({
  ipcRenderer: ipcRendererMock,
}));

describe('IPC renderer transport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('removes a conversation listener with the same wrapped callback identity', async () => {
    const { createIpcRendererTransport } = await import('./rendererTransport');
    const api = createRendererApi('win32', createIpcRendererTransport());
    const callback = vi.fn();

    api.conversation.onEvent(callback);
    const wrappedCallback = ipcRendererMock.on.mock.calls[0]?.[1];
    expect(typeof wrappedCallback).toBe('function');

    wrappedCallback({}, { type: 'message_patched' });
    expect(callback).toHaveBeenCalledWith({ type: 'message_patched' });

    api.conversation.offEvent(callback);
    expect(ipcRendererMock.removeListener).toHaveBeenCalledWith('conversation:event', wrappedCallback);
  });

  it('routes settings mutations through the canonical settings:set channel', async () => {
    ipcRendererMock.invoke.mockResolvedValue({ appearance: { language: 'en' } });
    const { createIpcRendererTransport } = await import('./rendererTransport');
    const api = createRendererApi('win32', createIpcRendererTransport());

    await api.settings.set({ appearance: { language: 'en' } });

    expect(ipcRendererMock.invoke).toHaveBeenCalledWith('settings:set', {
      appearance: { language: 'en' },
    });
  });
});
