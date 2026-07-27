import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ElectronAPI } from '@shared/types/electron';
import { installBrowserAppBridge } from './BrowserAppBridge';

const restoreGlobals = () => vi.unstubAllGlobals();
afterEach(restoreGlobals);

describe('BrowserAppBridge scoped capture contract', () => {
  it('sends an explicit project and session scope for opened-capture reads', async () => {
    const stored = new Map<string, string>();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, result: null }),
    });
    const browserWindow: { location: { href: string; origin: string }; sessionStorage: { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void }; electronAPI?: ElectronAPI } = {
      location: { href: 'http://127.0.0.1:4312/app?rdcBridgeToken=qa-token', origin: 'http://127.0.0.1:4312' },
      sessionStorage: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) },
      electronAPI: undefined,
    };
    vi.stubGlobal('window', browserWindow);
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('navigator', { platform: 'Win32' });
    vi.stubGlobal('fetch', fetchMock);

    installBrowserAppBridge();
    await browserWindow.electronAPI!.capture.getOpenedState({ projectId: 'project-a', sessionId: 'session-a' });

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:4312/invoke', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer qa-token' }),
      body: JSON.stringify({ channel: 'capture:getOpenedState', args: [{ projectId: 'project-a', sessionId: 'session-a' }] }),
    }));
  });
});