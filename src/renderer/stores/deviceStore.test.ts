import { describe, expect, it } from 'vitest';
import { useDeviceStore } from './deviceStore';

describe('replay device discovery', () => {
  it('ignores a late list response older than a discovery event', () => {
    const store = useDeviceStore.getState();
    store.applyStatusPayload({ revision: 12, devices: [], discovery: { status: 'failed', error: 'ADB unavailable' } });
    store.applyStatusPayload({ revision: 11, devices: [], discovery: { status: 'ready' } });
    expect(useDeviceStore.getState().discovery).toEqual({ status: 'failed', error: 'ADB unavailable' });
  });
  it('retains discovery facts independently of a connected session', () => {
    useDeviceStore.getState().applyStatusPayload({ revision: 13, discovery: { status: 'ready' }, devices: [{ id: 'android-test', label: 'Android', type: 'android', transport: 'adb_android', status: 'online', adbState: 'device' }] });
    expect(useDeviceStore.getState().devices[0].adbState).toBe('device');
    useDeviceStore.getState().applyStatusPayload({ revision: 14, discovery: { status: 'ready' }, devices: [] });
    expect(useDeviceStore.getState().devices.map(device => device.id)).toEqual(['local']);
  });
});
