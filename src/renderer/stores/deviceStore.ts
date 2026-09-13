import { create } from 'zustand';
import type { ReplayDeviceEntry, ReplayDeviceStatusChangedPayload } from '@shared/types/device';

interface DeviceState {
  devices: ReplayDeviceEntry[];
  selectedDevice: string;

  setDevices: (devices: ReplayDeviceEntry[]) => void;
  setSelectedDevice: (deviceId: string) => void;
  applyStatusPayload: (payload: ReplayDeviceStatusChangedPayload) => void;
  loadDevices: () => Promise<void>;
  refreshDevices: () => Promise<void>;
  startDeviceWatch: () => Promise<void>;
  stopDeviceWatch: () => Promise<void>;
}

const DEVICE_WATCH_RENEW_MS = 5000;
let deviceWatchRenewTimer: ReturnType<typeof setInterval> | null = null;

const LOCAL_DEVICE: ReplayDeviceEntry = {
  id: 'local',
  label: 'Local',
  type: 'local',
  status: 'online',
  transport: 'local',
};

function normalizeDevices(devices: ReplayDeviceEntry[], selectedDevice: string): Pick<DeviceState, 'devices' | 'selectedDevice'> {
  const nextDevices = devices.length > 0 ? devices : [LOCAL_DEVICE];
  const hasSelected = nextDevices.some((device) => device.id === selectedDevice);
  return {
    devices: nextDevices,
    selectedDevice: hasSelected ? selectedDevice : 'local',
  };
}

export const useDeviceStore = create<DeviceState>((set) => ({
  devices: [LOCAL_DEVICE],
  selectedDevice: 'local',

  setDevices: (devices) => set((state) => normalizeDevices(devices, state.selectedDevice)),

  setSelectedDevice: (deviceId) => set((state) => {
    const target = state.devices.find((device) => device.id === deviceId);
    if (!target) {
      return state;
    }

    if (target.status === 'loading') {
      return state;
    }

    return { selectedDevice: deviceId };
  }),

  applyStatusPayload: (payload) => {
    set((state) => normalizeDevices(payload.devices, state.selectedDevice));
  },

  loadDevices: async () => {
    try {
      const devices = await window.electronAPI.device.list();
      set((state) => normalizeDevices(devices ?? [LOCAL_DEVICE], state.selectedDevice));
    } catch {
      set((state) => normalizeDevices(state.devices, state.selectedDevice));
    }
  },

  refreshDevices: async () => {
    try {
      const devices = await window.electronAPI.device.refresh();
      set((state) => normalizeDevices(devices ?? state.devices, state.selectedDevice));
    } catch {
      set((state) => normalizeDevices(state.devices, state.selectedDevice));
    }
  },

  startDeviceWatch: async () => {
    try {
      await window.electronAPI.device.watchStart();
    } catch {
      return;
    }

    if (deviceWatchRenewTimer) {
      clearInterval(deviceWatchRenewTimer);
    }

    deviceWatchRenewTimer = setInterval(() => {
      void window.electronAPI.device.watchRenew().catch(() => undefined);
    }, DEVICE_WATCH_RENEW_MS);
  },

  stopDeviceWatch: async () => {
    if (deviceWatchRenewTimer) {
      clearInterval(deviceWatchRenewTimer);
      deviceWatchRenewTimer = null;
    }

    try {
      await window.electronAPI.device.watchStop();
    } catch {
      // ignore stop failures during teardown
    }
  },

}));
