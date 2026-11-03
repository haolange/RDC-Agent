import { z } from 'zod';
import { ipcId } from './IpcPayloadGuard';

export const TraceGetProjectionArgsSchema = z.tuple([
  ipcId(128, 'sessionId').optional(),
]);
