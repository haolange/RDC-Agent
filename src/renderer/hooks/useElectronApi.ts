import type { ElectronAPI } from '@shared/types/electron';

/** Single hook entry for renderer feature components that need IPC. */
export function useElectronApi(): ElectronAPI | undefined {
  return window.electronAPI;
}
