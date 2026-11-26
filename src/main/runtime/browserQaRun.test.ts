import { afterEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => ({ app: { isPackaged: true } }));
vi.mock('electron', () => electron);

import { isBrowserQaFullAccessRun, isBrowserQaRun } from './browserQaRun';

describe('Browser QA availability', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('never runs, nor grants full access, in a packaged build, whatever the environment says', () => {
    vi.stubEnv('RDC_AGENT_BROWSER_QA', '1');
    vi.stubEnv('RDC_AGENT_BROWSER_QA_FULL_ACCESS', '1');
    electron.app.isPackaged = true;
    expect(isBrowserQaRun()).toBe(false);
    expect(isBrowserQaFullAccessRun()).toBe(false);
    electron.app.isPackaged = false;
    expect(isBrowserQaRun()).toBe(true);
    expect(isBrowserQaFullAccessRun()).toBe(true);
  });
});
