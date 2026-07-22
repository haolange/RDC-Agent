import { ipcMain } from 'electron';
import { knowledgeBrowseService } from '../runtime/KnowledgeBrowseService';
import type { WorkbenchIpcContext } from './workbenchContext';

export function registerKnowledgeHandlers(_context: WorkbenchIpcContext): void {
  ipcMain.handle('knowledge:listSpaces', async () => ({
    spaces: knowledgeBrowseService.listSpaces(),
  }));

  ipcMain.handle('knowledge:listCards', async (_event, spaceId: string) => {
    if (typeof spaceId !== 'string' || !spaceId.trim()) {
      throw new Error('spaceId is required.');
    }
    return { cards: await knowledgeBrowseService.listCards(spaceId.trim()) };
  });

  ipcMain.handle('knowledge:getCard', async (_event, spaceId: string, relativePath: string) => {
    if (typeof spaceId !== 'string' || !spaceId.trim()) {
      throw new Error('spaceId is required.');
    }
    if (typeof relativePath !== 'string' || !relativePath.trim()) {
      throw new Error('relativePath is required.');
    }
    return {
      card: await knowledgeBrowseService.getCard(spaceId.trim(), relativePath.trim()),
    };
  });
}
