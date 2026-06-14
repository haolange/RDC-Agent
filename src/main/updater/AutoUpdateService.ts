/**
 * AutoUpdateService — electron-updater 自动更新 (lazy import).
 */
import type { BrowserWindow } from 'electron';

export class AutoUpdateService {
  private enabled: boolean;

  constructor() { this.enabled = !process.env.RDC_AGENT_DISABLE_AUTOUPDATE; }

  private getAutoUpdater() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    try { return (require('electron-updater') as { autoUpdater: { autoDownload: boolean; allowDowngrade: boolean; on: (e: string, cb: (...a: never[]) => void) => void; checkForUpdates: () => Promise<void>; downloadUpdate: () => Promise<void>; quitAndInstall: () => void } }).autoUpdater; }
    catch { return null; }
  }

  init(mainWindow: BrowserWindow): void {
    if (!this.enabled) return;
    const autoUpdater = this.getAutoUpdater();
    if (!autoUpdater) { console.warn('[AutoUpdate] electron-updater not installed'); return; }
    autoUpdater.autoDownload = false;
    autoUpdater.allowDowngrade = false;

    autoUpdater.on('update-available', () => mainWindow.webContents.send('app:updateAvailable'));
    autoUpdater.on('update-downloaded', () => mainWindow.webContents.send('app:updateDownloaded'));
    autoUpdater.on('error', (err: Error) => console.warn('[AutoUpdate]', err.message));

    setTimeout(() => { autoUpdater.checkForUpdates().catch(() => {}); }, 10_000);
  }

  async checkForUpdates(): Promise<void> {
    const au = this.getAutoUpdater();
    if (au) await au.checkForUpdates();
  }

  downloadUpdate(): void { this.getAutoUpdater()?.downloadUpdate().catch(() => {}); }
  quitAndInstall(): void { this.getAutoUpdater()?.quitAndInstall(); }
}
