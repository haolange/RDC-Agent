import { ipcRenderer } from 'electron';
import type { CaptureApi, ContextApi, DeviceApi } from '@shared/types/electron-api';

export const createDeviceApi = (): DeviceApi => ({
  list: (): ReturnType<DeviceApi['list']> => ipcRenderer.invoke('device:list'),
  refresh: (): ReturnType<DeviceApi['refresh']> => ipcRenderer.invoke('device:refresh'),
  activate: (deviceId): ReturnType<DeviceApi['activate']> => ipcRenderer.invoke('device:activate', deviceId),
});

export const createCaptureApi = (): CaptureApi => ({
  list: (): ReturnType<CaptureApi['list']> => ipcRenderer.invoke('capture:list'),
  select: (captureId): ReturnType<CaptureApi['select']> => ipcRenderer.invoke('capture:select', captureId),
  openProjectInput: (request): ReturnType<CaptureApi['openProjectInput']> =>
    ipcRenderer.invoke('capture:openProjectInput', request),
  getOpenedState: (): ReturnType<CaptureApi['getOpenedState']> => ipcRenderer.invoke('capture:getOpenedState'),
  clearOpenedState: (): ReturnType<CaptureApi['clearOpenedState']> => ipcRenderer.invoke('capture:clearOpenedState'),
});

export const createContextApi = (): ContextApi => ({
  get: (): ReturnType<ContextApi['get']> => ipcRenderer.invoke('context:get'),
  openHumanPreview: (request): ReturnType<ContextApi['openHumanPreview']> =>
    ipcRenderer.invoke('context:openHumanPreview', request),
  closeHumanPreview: (): ReturnType<ContextApi['closeHumanPreview']> =>
    ipcRenderer.invoke('context:closeHumanPreview'),
});
