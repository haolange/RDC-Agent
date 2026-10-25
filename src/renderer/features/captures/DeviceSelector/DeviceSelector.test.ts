// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { DeviceSelector } from './index';
const mocks = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), select: vi.fn() }));
vi.mock('../../../stores/deviceStore', () => ({ useDeviceStore: () => ({
  selectedDevice: 'local', devices: [
    { id: 'local', type: 'local', label: 'Local', status: 'connected' },
    { id: 'loading', type: 'android', label: 'Loading', status: 'loading' },
    { id: 'remote', type: 'android', label: 'Remote', status: 'disconnected' },
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
