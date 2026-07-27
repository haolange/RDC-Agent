import { ipcRenderer } from 'electron';
import type { CaptureApi, ContextApi, DeviceApi } from '@shared/types/electron-api';

export const createDeviceApi = (): DeviceApi => ({
  list: (): ReturnType<DeviceApi['list']> => ipcRenderer.invoke('device:list'),
  refresh: (): ReturnType<DeviceApi['refresh']> => ipcRenderer.invoke('device:refresh'),
  activate: (deviceId): ReturnType<DeviceApi['activate']> => ipcRenderer.invoke('device:activate', deviceId),
});

export const createCaptureApi = (): CaptureApi => ({
  list: (scope): ReturnType<CaptureApi['list']> => ipcRenderer.invoke('capture:list', scope),
  select: (request): ReturnType<CaptureApi['select']> => ipcRenderer.invoke('capture:select', request),
  openProjectInput: (request): ReturnType<CaptureApi['openProjectInput']> =>
    ipcRenderer.invoke('capture:openProjectInput', request),
  getOpenedState: (scope): ReturnType<CaptureApi['getOpenedState']> => ipcRenderer.invoke('capture:getOpenedState', scope),
  clearOpenedState: (scope): ReturnType<CaptureApi['clearOpenedState']> => ipcRenderer.invoke('capture:clearOpenedState', scope),
});

export const createContextApi = (): ContextApi => ({
  get: (scope): ReturnType<ContextApi['get']> => ipcRenderer.invoke('context:get', scope),
  openHumanPreview: (scope): ReturnType<ContextApi['openHumanPreview']> =>
    ipcRenderer.invoke('context:openHumanPreview', scope),
  closeHumanPreview: (scope): ReturnType<ContextApi['closeHumanPreview']> =>
    ipcRenderer.invoke('context:closeHumanPreview', scope),
});
