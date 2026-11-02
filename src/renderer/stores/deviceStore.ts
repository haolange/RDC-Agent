import { create } from 'zustand';
import type { ReplayDeviceEntry, ReplayDeviceSnapshot, ReplayDeviceStatusChangedPayload } from '@shared/types/device';

interface DeviceState {
  devices: ReplayDeviceEntry[];
  revision: number;
  discovery: ReplayDeviceSnapshot['discovery'];

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

export const useDeviceStore = create<DeviceState>((set, get) => ({
  devices: [LOCAL_DEVICE],
  revision: -1,
  discovery: { status: 'idle' },

  applyStatusPayload: (payload) => {
    set((state) => payload.revision < state.revision ? state : ({
      devices: payload.devices.length ? payload.devices : [LOCAL_DEVICE], revision: payload.revision, discovery: payload.discovery,
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
