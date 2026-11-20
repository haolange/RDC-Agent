import { afterEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => ({ app: { isPackaged: true } }));
vi.mock('electron', () => electron);

import { shouldStartBrowserAppBridge } from './BrowserAppBridgeServer';

describe('Browser QA availability', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('never starts in a packaged build, whatever the environment says', () => {
    vi.stubEnv('RDC_AGENT_BROWSER_QA', '1');
    electron.app.isPackaged = true;
    expect(shouldStartBrowserAppBridge()).toBe(false);
    electron.app.isPackaged = false;
    expect(shouldStartBrowserAppBridge()).toBe(true);
  });
});
