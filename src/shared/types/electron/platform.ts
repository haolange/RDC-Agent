import type { ElectronAPI } from '../electron';
export type AppMetaApi = ElectronAPI['appMeta'];
export type AppShellApi = ElectronAPI['appShell'];
export type WindowControlsApi = ElectronAPI['windowControls'];
export type DialogApi = Pick<
  ElectronAPI,
  'selectFiles' | 'selectRdcFiles' | 'selectKnowledgeImport' | 'selectDirectory'
>;
