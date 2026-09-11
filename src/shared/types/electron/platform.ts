import type { ElectronAPI } from '../electron';

export type PlatformApi = Pick<ElectronAPI, 'platform' | 'isMac' | 'isWindows' | 'isLinux'>;
export type AppMetaApi = ElectronAPI['appMeta'];
export type AppShellApi = ElectronAPI['appShell'];
export type WindowControlsApi = ElectronAPI['windowControls'];
export type DialogApi = Pick<ElectronAPI, 'selectFiles' | 'selectRdcFiles' | 'selectDirectory' | 'saveFile'>;
export type RawChannelSubscriptionApi = Pick<ElectronAPI, 'on' | 'off'>;
