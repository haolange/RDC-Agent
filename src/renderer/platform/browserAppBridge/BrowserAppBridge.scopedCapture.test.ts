import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ElectronAPI } from '@shared/types/electron';
import { installBrowserAppBridge } from './BrowserAppBridge';

const restoreGlobals = () => vi.unstubAllGlobals();
afterEach(restoreGlobals);

describe('BrowserAppBridge scoped capture contract', () => {
  it('decodes JSON Buffer image replies without changing the desktop byte contract', async () => {
    const browserWindow = { location: { origin: 'http://127.0.0.1:4312' }, electronAPI: undefined as ElectronAPI | undefined };
    vi.stubGlobal('window', browserWindow);
    vi.stubGlobal('navigator', { platform: 'Win32' });
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true,
      json: async () => ({ success: true, result: JSON.parse(JSON.stringify(png)) }) });
    vi.stubGlobal('fetch', fetchMock);
    installBrowserAppBridge();
    const scope = { projectId: 'project-a', sessionId: 'session-a' };
    expect(await browserWindow.electronAPI!.capture.readLivePreview(scope)).toEqual(new Uint8Array(png));
    expect(await browserWindow.electronAPI!.capture.readReplayImage({ ...scope, captureHash: 'a'.repeat(64), imageHash: 'b'.repeat(64) })).toEqual(new Uint8Array(png));
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, result: { type: 'Buffer', data: [256] } }) });
    await expect(browserWindow.electronAPI!.capture.readLivePreview(scope)).rejects.toThrow('BRIDGE_INVALID_IMAGE_BYTES');
  });
  it('sends an explicit project and session scope for opened-capture reads', async () => {
    const stored = new Map<string, string>();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, result: null }),
    });
    const browserWindow: { location: { href: string; origin: string }; sessionStorage: { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void }; electronAPI?: ElectronAPI } = {
      location: { href: 'http://127.0.0.1:4312/app', origin: 'http://127.0.0.1:4312' },
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
      credentials: 'include',
      body: JSON.stringify({ channel: 'capture:getOpenedState', args: [{ projectId: 'project-a', sessionId: 'session-a' }] }),
    }));
  });
});
