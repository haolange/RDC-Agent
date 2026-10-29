import { create } from 'zustand';
import type { ReplayDeviceEntry, ReplayDeviceSnapshot, ReplayDeviceStatusChangedPayload } from '@shared/types/device';

interface DeviceState {
  devices: ReplayDeviceEntry[];
  selectedDevice: string;
  revision: number;
  discovery: ReplayDeviceSnapshot['discovery'];

  setSelectedDevice: (deviceId: string) => void;
  applyStatusPayload: (payload: ReplayDeviceStatusChangedPayload) => void;
  loadDevices: () => Promise<void>;
  refreshDevices: () => Promise<void>;
  startDeviceWatch: () => Promise<void>;
  stopDeviceWatch: () => Promise<void>;
}

const DEVICE_WATCH_RENEW_MS = 5000;
let deviceWatchRenewTimer: ReturnType<typeof setInterval> | null = null;
let watchGeneration = 0;

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

export const useDeviceStore = create<DeviceState>((set, get) => ({
  devices: [LOCAL_DEVICE],
  selectedDevice: 'local',
  revision: -1,
  discovery: { status: 'idle' },

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
    set((state) => payload.revision < state.revision ? state : ({
      ...normalizeDevices(payload.devices, state.selectedDevice), revision: payload.revision, discovery: payload.discovery,
    }));
  },

  loadDevices: async () => {
    try {
      get().applyStatusPayload(await window.electronAPI.device.list());
    } catch (error) {
      set({ discovery: { status: 'failed', error: error instanceof Error ? error.message : String(error) } });
    }
  },

  refreshDevices: async () => {
    try {
      get().applyStatusPayload(await window.electronAPI.device.refresh());
    } catch (error) {
      set({ discovery: { status: 'failed', error: error instanceof Error ? error.message : String(error) } });
    }
  },

  startDeviceWatch: async () => {
    const generation = ++watchGeneration;
    try {
      await window.electronAPI.device.watchStart();
    } catch (error) {
      if (generation === watchGeneration) set({ discovery: { status: 'failed', error: error instanceof Error ? error.message : String(error) } });
      return;
    }

    if (generation !== watchGeneration) return;
    if (deviceWatchRenewTimer) {
      clearInterval(deviceWatchRenewTimer);
    }

    deviceWatchRenewTimer = setInterval(() => {
      void window.electronAPI.device.watchRenew().catch(() => undefined);
    }, DEVICE_WATCH_RENEW_MS);
  },

  stopDeviceWatch: async () => {
    watchGeneration += 1;
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
