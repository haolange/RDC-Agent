import { z } from 'zod';
import { ipcNonEmptyString, ipcString } from './IpcPayloadGuard';

export const AgentSendMessageArgsSchema = z.tuple([
  ipcNonEmptyString(200, 'agentId'),
  ipcString(200_000, 'content'),
]);

export const AgentGetStateArgsSchema = z.tuple([
  ipcNonEmptyString(200, 'agentId'),
  ipcNonEmptyString(200, 'sessionId').optional(),
]);

export const AgentConfigureArgsSchema = z.tuple([
  ipcNonEmptyString(200, 'agentId'),
  z.record(z.string().max(200), z.unknown()).refine(
    (value) => Object.keys(value).length <= 64,
    'config exceeds 64 keys',
  ),
]);
