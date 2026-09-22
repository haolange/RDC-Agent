import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';

const f = vi.hoisted(() => ({
  appearance: { theme: 'system', chromeThemes: { dark: { accent: '#ff0000' }, light: { accent: '#0000ff' } } },
  theme: { shouldUseDarkColors: true },
  app: { isPackaged: false, getAppPath: () => '/application' },
  fromPath: vi.fn(), fromBitmap: vi.fn(), resize: vi.fn(), log: vi.fn(),
}));
vi.mock('electron', () => ({ app: f.app, nativeTheme: f.theme,
  nativeImage: { createFromPath: f.fromPath, createFromBitmap: f.fromBitmap } }));
vi.mock('../settings/SettingsService', () => ({ settingsService: { getAll: () => ({ appearance: f.appearance }) } }));
vi.mock('../runtime/RuntimeLogService', () => ({ runtimeLogService: { log: f.log } }));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  f.theme.shouldUseDarkColors = true; f.app.isPackaged = false; f.appearance.theme = 'system';
  const original = { isEmpty: () => false, resize: f.resize };
  f.fromPath.mockReturnValue(original);
  f.resize.mockReturnValue({ getSize: () => ({ width: 3, height: 1 }),
    toBitmap: () => Buffer.from([0, 255, 0, 255, 255, 255, 255, 255, 8, 12, 4, 255]) });
  f.fromBitmap.mockImplementation((bytes: Buffer) => ({ isEmpty: () => false, bytes }));
});
function windowFixture() {
  const callbacks = new Map<string, () => void>();
  const setIcon = vi.fn();
  const window = { isDestroyed: () => false, setIcon,
    once: (event: string, callback: () => void) => callbacks.set(event, callback) } as unknown as BrowserWindow;
  return { window, setIcon, close: () => callbacks.get('closed')!() };
}
describe('product window icon', () => {
  it('converts Windows BGRA, preserves neutrals and rebuilds on system theme changes', async () => {
    const { bindProductIcon, applyProductIcon } = await import('./productIcon');
    const w = windowFixture(); bindProductIcon(w.window);
    expect(f.fromPath.mock.calls[0][0].replaceAll('\\', '/')).toBe('/application/resources/brand/rdc-agent-logo.png');
    expect(f.resize).toHaveBeenCalledWith({ width: 256, height: 256, quality: 'best' });
    expect([...f.fromBitmap.mock.calls[0][0]]).toEqual([0, 0, 255, 255, 255, 255, 255, 255, 8, 12, 4, 255]);
    applyProductIcon(); expect(f.fromBitmap).toHaveBeenCalledTimes(1);
    f.theme.shouldUseDarkColors = false; applyProductIcon();
    expect([...f.fromBitmap.mock.calls[1][0]].slice(0, 4)).toEqual([255, 0, 0, 255]);
    expect(f.fromPath).toHaveBeenCalledTimes(1);
    expect(w.setIcon).toHaveBeenCalledTimes(3);
    w.close(); applyProductIcon(); expect(w.setIcon).toHaveBeenCalledTimes(3);
  });
  it('uses the packaged resource root and respects an explicit theme', async () => {
    Object.defineProperty(process, 'resourcesPath', { value: '/packaged/resources', configurable: true });
    f.app.isPackaged = true; f.appearance.theme = 'light';
    const { bindProductIcon } = await import('./productIcon');
    const w = windowFixture(); bindProductIcon(w.window);
    expect(f.fromPath.mock.calls[0][0].replaceAll('\\', '/')).toBe('/packaged/resources/brand/rdc-agent-logo.png');
    expect([...f.fromBitmap.mock.calls[0][0]].slice(0, 4)).toEqual([255, 0, 0, 255]);
    w.close();
  });
  it('reports missing assets and setIcon failures without rejecting saved settings', async () => {
    const { bindProductIcon, applyProductIcon } = await import('./productIcon');
    const w = windowFixture();
    f.fromPath.mockReturnValueOnce({ isEmpty: () => true });
    expect(() => bindProductIcon(w.window)).not.toThrow();
    expect(f.log).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warning', summary: expect.stringContaining('missing or invalid') }));
    w.setIcon.mockImplementationOnce(() => { throw new Error('native failure'); });
    expect(applyProductIcon).not.toThrow();
    expect(f.log).toHaveBeenLastCalledWith(expect.objectContaining({ summary: 'native failure' }));
    applyProductIcon(); expect(w.setIcon).toHaveBeenCalledTimes(2);
    w.close();
  });
});
