import { ipcRenderer } from 'electron';
import type { KnowledgeApi } from '@shared/types/electron-api';

export const createKnowledgeApi = (): KnowledgeApi => ({
  listSpaces: (): ReturnType<KnowledgeApi['listSpaces']> => ipcRenderer.invoke('knowledge:listSpaces'),
  listCards: (spaceId): ReturnType<KnowledgeApi['listCards']> => ipcRenderer.invoke('knowledge:listCards', spaceId),
  getCard: (spaceId, relativePath): ReturnType<KnowledgeApi['getCard']> =>
    ipcRenderer.invoke('knowledge:getCard', spaceId, relativePath),
});
