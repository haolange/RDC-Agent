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

const REJECTED_AGENT_CONFIG_KEYS = new Set(['category', 'writeScope', 'mode']);

export const AgentConfigureArgsSchema = z.tuple([
  ipcNonEmptyString(200, 'agentId'),
  z.record(z.string().max(200), z.unknown()).superRefine((value, ctx) => {
    if (Object.keys(value).length > 64) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'config exceeds 64 keys' });
    }
    for (const key of Object.keys(value)) {
      if (REJECTED_AGENT_CONFIG_KEYS.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `agent:configure does not accept ${key}; identity comes from agentId/profileId.`,
        });
      }
    }
  }),
]);
