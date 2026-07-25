import { ipcMain } from 'electron';
import { knowledgeBrowseService } from '../runtime/KnowledgeBrowseService';
import type { WorkbenchIpcContext } from './workbenchContext';
import { parseIpcArgs } from './validation/IpcPayloadGuard';
import { EmptyArgsSchema } from './validation/commonIpcSchemas';
import {
  KnowledgeGetCardArgsSchema,
  KnowledgeListCardsArgsSchema,
} from './validation/knowledgeSchemas';

export function registerKnowledgeHandlers(_context: WorkbenchIpcContext): void {
  ipcMain.handle('knowledge:listSpaces', async (_event, ...rawArgs: unknown[]) => {
    parseIpcArgs(EmptyArgsSchema, rawArgs, { label: 'knowledge:listSpaces', maxBytes: 1024 });
    return {
      spaces: knowledgeBrowseService.listSpaces(),
    };
  });

  ipcMain.handle('knowledge:listCards', async (_event, ...rawArgs: unknown[]) => {
    const [spaceId] = parseIpcArgs(KnowledgeListCardsArgsSchema, rawArgs, {
      label: 'knowledge:listCards',
      maxBytes: 4 * 1024,
    });
    return { cards: await knowledgeBrowseService.listCards(spaceId.trim()) };
  });

  ipcMain.handle('knowledge:getCard', async (_event, ...rawArgs: unknown[]) => {
    const [spaceId, relativePath] = parseIpcArgs(KnowledgeGetCardArgsSchema, rawArgs, {
      label: 'knowledge:getCard',
      maxBytes: 8 * 1024,
    });
    return {
      card: await knowledgeBrowseService.getCard(spaceId.trim(), relativePath.trim()),
    };
  });
}
