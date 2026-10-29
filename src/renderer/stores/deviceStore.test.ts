import { describe, expect, it } from 'vitest';
import { useDeviceStore } from './deviceStore';

describe('replay device selection before owning capture context', () => {
  it('ignores a late list response older than an already received discovery event', () => {
    const store = useDeviceStore.getState();
    store.applyStatusPayload({ revision: 12, devices: [], discovery: { status: 'failed', error: 'ADB unavailable' } });
    store.applyStatusPayload({ revision: 11, devices: [], discovery: { status: 'ready' } });
    expect(useDeviceStore.getState().discovery).toEqual({ status: 'failed', error: 'ADB unavailable' });
  });
  it('allows selecting an offline Android device without activating it', () => {
    useDeviceStore.getState().applyStatusPayload({ revision: 13, discovery: { status: 'ready' }, devices: [{ id: 'android-test', label: 'Android', type: 'android', transport: 'adb_android', status: 'offline' }] });
    useDeviceStore.getState().setSelectedDevice('android-test');
    expect(useDeviceStore.getState().selectedDevice).toBe('android-test');
    expect(useDeviceStore.getState().devices[0].status).toBe('offline');
    useDeviceStore.getState().applyStatusPayload({ revision: 14, discovery: { status: 'ready' }, devices: [] });
  });
});
