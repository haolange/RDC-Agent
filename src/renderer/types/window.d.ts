import type { ElectronAPI } from '@shared/types/electron';

declare global {
  interface Window {
    electronAPI: ElectronAPI;
    rdcDesktop?: {
      getPathForFile(file: File): string | null;
    };
  }
}

export {};
