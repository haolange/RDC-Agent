import { z } from 'zod';
import { ipcNonEmptyString } from './IpcPayloadGuard';

/** spaceId may be `user` or `project:<projectId>`. */
export const KnowledgeListCardsArgsSchema = z.tuple([
  ipcNonEmptyString(200, 'spaceId'),
]);

export const KnowledgeGetCardArgsSchema = z.tuple([
  ipcNonEmptyString(200, 'spaceId'),
  ipcNonEmptyString(1024, 'relativePath'),
]);
