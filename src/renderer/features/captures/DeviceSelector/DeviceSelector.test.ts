// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DeviceSelector } from './index';
import { useDeviceStore } from '../../../stores/deviceStore';
import { useSessionDeviceStore } from '../../../stores/sessionDeviceStore';
import { replayFixture } from '../../../testing/replayFixture';
const mocks = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), select: vi.fn(), activeSession: true, unconfirmed: false, connected: false }));
vi.mock('../../../stores/projectStore', () => ({ useProjectStore: (selector: (value: unknown) => unknown) => selector({ currentProject: { projectId: 'project' }, currentSession: mocks.activeSession ? { sessionId: 'session' } : null }) }));
vi.mock('../../../hooks/useSessionDevicePreparation', () => ({ useSessionDevicePreparation: () => ({ state: replayFixture(mocks.unconfirmed ? {
  preparation: { targetDeviceId: 'remote', phase: 'failed', issue: { code: 'remote_install_unconfirmed', stage: 'installing', diagnostic: 'Pending installation', recovery: 'retry', deviceAction: { kind: 'package_install', outcome: 'unconfirmed', uninstalledExisting: false } } },
} : mocks.connected ? { preparation: { targetDeviceId: 'remote', phase: 'ready', issue: null } } : {}), error: null, actionFailure: null }) }));
vi.mock('../DevicePreparationDialog', () => ({ DevicePreparationDialog: () => null }));
vi.mock('../../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); mocks.activeSession = true; mocks.unconfirmed = false; mocks.connected = false;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  useDeviceStore.setState({ startDeviceWatch: mocks.start, stopDeviceWatch: mocks.stop, refreshDevices: vi.fn(), discovery: { status: 'ready' }, devices: [
    { id: 'local', type: 'local', transport: 'local', label: 'Local', status: 'online' },
    { id: 'unauthorized', type: 'android', transport: 'adb_android', label: 'Unauthorized', status: 'offline', adbState: 'unauthorized' },
    { id: 'remote', type: 'android', transport: 'adb_android', label: 'A'.repeat(500), serial: 'b54ed446', status: 'online', adbState: 'device' },
  ] });
  useSessionDeviceStore.setState({ prepare: mocks.select });
});
afterEach(() => { vi.unstubAllGlobals(); });
it('blocks device selection while installation is unknown and verifies the owning target explicitly', async () => {
  mocks.unconfirmed = true;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(DeviceSelector)));
    await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
    const options = document.querySelectorAll<HTMLButtonElement>('[role="option"]');
    expect([...options].every(option => option.disabled)).toBe(true);
    const verify = [...document.querySelectorAll<HTMLButtonElement>('.device-preparation-actions button')].find(button => button.textContent === 'device.prepare.retry');
    expect(verify?.disabled).toBe(false);
    await act(async () => verify!.click());
    expect(mocks.select).toHaveBeenCalledExactlyOnceWith({ projectId: 'project', sessionId: 'session' }, 'remote');
    expect(document.querySelector('.device-preparation-status')?.textContent).toContain('device.prepare.installUnconfirmed');
  } finally { await act(async () => root.unmount()); host.remove(); }
});
it('navigates actual device states, starts preparation on selection and returns focus on Escape', async () => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(DeviceSelector)));
    const trigger = host.querySelector<HTMLButtonElement>('[data-testid="utility-device-selector-trigger"]')!;
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    await act(async () => trigger.click());
    const options = document.querySelectorAll<HTMLButtonElement>('[role="option"]');
    expect(options[2].textContent).toBe('A'.repeat(500) + 'b54ed446' + 'device.discovery.available');
    expect(options[2].querySelector('.device-option-serial')?.textContent).toBe('b54ed446');
    expect(options[2].title).toContain('b54ed446');
    expect(document.querySelector('.device-discovery-status')).toBeNull();
    expect(options[1].disabled).toBe(true); expect(document.activeElement).toBe(options[0]);
    await act(async () => options[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    expect(document.activeElement).toBe(options[2]);
    await act(async () => options[2].click());
    expect(mocks.select).toHaveBeenCalledWith({ projectId: 'project', sessionId: 'session' }, 'remote');
    expect(document.querySelector('[role="listbox"]')!.textContent).not.toContain('CheckRemoteServerConnection');
    await act(async () => options[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('[role="listbox"]')).toBeNull(); expect(document.activeElement).toBe(trigger);
    expect(mocks.start).toHaveBeenCalledOnce(); expect(mocks.stop).toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); }
});
it('requires an active session before connecting and leaves discovery readable', async () => {
  mocks.activeSession = false;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(DeviceSelector)));
    await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
    expect(document.body.textContent).toContain('device.prepare.noSession');
    const options = document.querySelectorAll<HTMLButtonElement>('[role="option"]');
    expect([...options].every(option => option.disabled)).toBe(true);
    expect(mocks.select).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it.each(['unauthorized', 'offline', 'missing'] as const)('keeps %s explicit without diagnostics in option text', async (adbState) => {
  useDeviceStore.setState(state => ({ devices: state.devices.map(device => device.id === 'remote' ? { ...device, status: 'offline', adbState } : device) }));
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(DeviceSelector)));
    await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
    const option = document.querySelectorAll<HTMLButtonElement>('[role="option"]')[2];
    expect(option.textContent).toBe('A'.repeat(500) + 'b54ed446' + (adbState === 'unauthorized' ? 'device.status.unauthorized' : 'device.status.offline'));
    expect(option.querySelector('.device-option-status')?.classList.contains('is-error')).toBe(true);
    expect(option.disabled).toBe(true);
    expect(option.querySelector('.device-option-serial')?.textContent).toBe('b54ed446');
    expect(option.title).toContain('b54ed446');
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it('shows the current connection state instead of ADB availability on the selected device', async () => {
  mocks.connected = true;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(DeviceSelector)));
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="utility-device-selector-trigger"]')!.click());
    const selected = document.querySelector('[role="option"][aria-selected="true"]')!;
    expect(selected.textContent).toContain('device.prepare.connected');
    expect(selected.textContent).not.toContain('device.discovery.available');
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});
