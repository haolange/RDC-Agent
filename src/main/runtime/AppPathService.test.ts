import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => ({ root: '' }));
vi.mock('electron', () => ({
  app: { getPath: () => electronMock.root },
}));

describe('AppPathService', () => {
  let root = '';

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-app-path-'));
    electronMock.root = root;
    delete process.env.RDC_AGENT_HOME;
    delete process.env.RDC_AGENT_USER_DATA;
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('memoizes initializeRuntime for the same user and app state roots', async () => {
    const { AppPathService } = await import('./AppPathService');
    const service = new AppPathService();
    const mkdirSpy = vi.spyOn(fs, 'mkdirSync');

    const first = service.initializeRuntime();
    const firstCallCount = mkdirSpy.mock.calls.length;
    expect(firstCallCount).toBeGreaterThan(0);

    const second = service.initializeRuntime();
    expect(second).toBe(first);
    expect(mkdirSpy.mock.calls.length).toBe(firstCallCount);
  });
});
