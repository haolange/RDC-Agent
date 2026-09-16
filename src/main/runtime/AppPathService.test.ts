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
    expect(first.rdxIntermediateRoot).toBe(path.join(first.userRdxRoot, 'rdx-intermediate'));
    expect(mkdirSpy.mock.calls.some((call) => String(call[0]).endsWith('rdx-intermediate'))).toBe(false);

    const second = service.initializeRuntime();
    expect(second).toBe(first);
    expect(mkdirSpy.mock.calls.length).toBe(firstCallCount);
  });
  it('adds replay exclusions to existing project rules without creating an unused replay directory', async () => {
    const { AppPathService } = await import('./AppPathService');
    const service = new AppPathService();
    fs.mkdirSync(path.join(root, '.rdx'));
    fs.writeFileSync(path.join(root, '.rdx', '.gitignore'), 'custom-rule/');
    const paths = service.initializeProjectRdx(root);
    service.initializeProjectRdx(root);
    expect(paths.replayPath).toBe(path.join(root, '.rdx', 'replay'));
    expect(fs.existsSync(paths.replayPath)).toBe(false);
    const ignore = fs.readFileSync(paths.gitignorePath, 'utf8');
    expect(ignore).toContain('custom-rule/');
    expect(ignore.match(/^replay\/$/gm)).toHaveLength(1);
    expect(ignore.match(/^replay\.lock$/gm)).toHaveLength(1);
  });
});
