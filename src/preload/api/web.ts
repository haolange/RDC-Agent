import { ipcRenderer } from 'electron';
import type { ElectronAPI } from '@shared/types/electron';

type WebApi = ElectronAPI['web'];

export const createWebApi = (): WebApi => ({
  resolveFavicon: (domain): ReturnType<WebApi['resolveFavicon']> =>
    ipcRenderer.invoke('web:resolveFavicon', domain),
});
