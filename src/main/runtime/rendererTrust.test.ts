import { describe, expect, it, vi } from 'vitest';

const openExternal = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('electron', () => ({ shell: { openExternal } }));

import { isTrustedRendererUrl, openExternalHttps, trustRendererEntry } from './rendererTrust';

describe('renderer trust', () => {
  it('trusts only the exact packaged entry file, never another local page', () => {
    trustRendererEntry('file:///opt/rdc-agent/resources/app/out/renderer/index.html');
    expect(isTrustedRendererUrl('file:///opt/rdc-agent/resources/app/out/renderer/index.html#/settings')).toBe(true);
    expect(isTrustedRendererUrl('file:///home/user/Downloads/report.html')).toBe(false);
    expect(isTrustedRendererUrl(undefined)).toBe(false);
  });

  it('trusts a dev server by origin', () => {
    trustRendererEntry('http://127.0.0.1:5173/');
    expect(isTrustedRendererUrl('http://127.0.0.1:5173/src/main.tsx')).toBe(true);
    expect(isTrustedRendererUrl('http://127.0.0.1:5174/')).toBe(false);
  });

  it('opens sign-in pages only over https', async () => {
    await openExternalHttps('https://auth.example.com/authorize');
    expect(openExternal).toHaveBeenCalledWith('https://auth.example.com/authorize');
    await expect(openExternalHttps('file:///etc/passwd')).rejects.toThrow(/EXTERNAL_URL_REJECTED/);
  });
});
