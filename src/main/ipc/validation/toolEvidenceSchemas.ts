import { z } from 'zod';
import { ipcString } from './IpcPayloadGuard';

export const EvidenceGetEventsArgsSchema = z.tuple([
  ipcString(128, 'eventType').optional(),
]);
