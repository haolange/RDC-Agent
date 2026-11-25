import type { DesktopIpc } from '@shared/renderer-api/transport';
import type { ElectronAPI } from '@shared/types/electron';

declare global {
  interface Window {
    electronAPI: ElectronAPI;
    /** Exposed by the desktop preload; absent under the Browser QA bridge. */
    rdcIpc?: DesktopIpc;
    rdcDesktop?: {
      getPathForFile(file: File): string | null;
    };
  }
}

export {};
