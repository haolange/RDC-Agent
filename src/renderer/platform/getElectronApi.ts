import type { ElectronAPI } from '@shared/types/electron';

export function getElectronApi(): ElectronAPI | undefined {
  return window.electronAPI;
}
