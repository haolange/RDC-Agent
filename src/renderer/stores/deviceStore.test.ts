import { describe, expect, it } from 'vitest';
import { useDeviceStore } from './deviceStore';

describe('replay device selection before owning capture context', () => {
  it('allows selecting an offline Android device without activating it', () => {
    useDeviceStore.getState().setDevices([{ id: 'android-test', label: 'Android', type: 'android', transport: 'adb_android', status: 'offline' }]);
    useDeviceStore.getState().setSelectedDevice('android-test');
    expect(useDeviceStore.getState().selectedDevice).toBe('android-test');
    expect(useDeviceStore.getState().devices[0].status).toBe('offline');
    useDeviceStore.getState().setDevices([]);
  });
});
