// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { DeviceSelector } from './index';
const mocks = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), select: vi.fn(), adbState: 'device' }));
vi.mock('../../../stores/deviceStore', () => ({ useDeviceStore: () => ({
  selectedDevice: 'local', discovery: { status: 'ready' }, refreshDevices: vi.fn(), devices: [
    { id: 'local', type: 'local', label: 'Local', status: 'connected' },
    { id: 'loading', type: 'android', label: 'Loading', status: 'loading' },
    { id: 'remote', type: 'android', label: 'darwin', status: 'offline', adbState: mocks.adbState,
      serial: 'qa-android-serial', detailText: 'Ready to connect to Android RenderDoc server. transport 1',
      bootstrap: { packageName: 'org.renderdoc.renderdoccmd.arm64', abi: 'arm64-v8a' } },
  ], setSelectedDevice: mocks.select, startDeviceWatch: mocks.start, stopDeviceWatch: mocks.stop,
}) }));
vi.mock('../../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('../../../lib/useDynStyle', () => ({ useDynStyle: () => ({}) }));
vi.mock('./useDeviceDropdownPosition', () => ({ useDeviceDropdownPosition: () => ({ left: 0, top: 0, width: 200, ready: true, placement: 'bottom' }) }));
it('supports option navigation, loading disablement, Escape focus return and watch cleanup', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks();
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(DeviceSelector)));
    const trigger = host.querySelector<HTMLButtonElement>('[data-testid="utility-device-selector-trigger"]')!;
    await act(async () => trigger.click());
    const options = document.querySelectorAll<HTMLButtonElement>('[role="option"]');
    expect(options[2].textContent).toBe('darwindevice.status.disconnected');
    expect(options[2].textContent).not.toMatch(/transport|qa-android-serial|org\.renderdoc|arm64/u);
    expect(options[2].title).toContain('qa-android-serial');
    expect(options[2].title).toContain('org.renderdoc.renderdoccmd.arm64');
    expect(options[0].textContent?.match(/device.status.connected/gu)).toHaveLength(1);
    expect(options[1].disabled).toBe(true); expect(document.activeElement).toBe(options[0]);
    await act(async () => options[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    expect(document.activeElement).toBe(options[2]);
    await act(async () => options[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('[role="listbox"]')).toBeNull(); expect(document.activeElement).toBe(trigger);
    expect(mocks.start).toHaveBeenCalledOnce(); expect(mocks.stop).toHaveBeenCalled();
    await act(async () => trigger.click());
    await act(async () => document.querySelectorAll<HTMLButtonElement>('[role="option"]')[2].click());
    expect(mocks.select).toHaveBeenCalledWith('remote'); expect(document.activeElement).toBe(trigger);
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});

it.each(['unauthorized', 'offline', 'missing'])('keeps the %s state explicit without diagnostic paragraphs', async (adbState) => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); mocks.adbState = adbState;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(DeviceSelector)));
    await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
    const option = document.querySelectorAll<HTMLButtonElement>('[role="option"]')[2];
    expect(option.textContent).toBe(`darwindevice.status.${adbState === 'unauthorized' ? 'unauthorized' : 'offline'}`);
    expect(option.querySelector('.device-option-status')?.classList.contains('is-error')).toBe(true);
  } finally { await act(async () => root.unmount()); host.remove(); mocks.adbState = 'device'; vi.unstubAllGlobals(); }
});
