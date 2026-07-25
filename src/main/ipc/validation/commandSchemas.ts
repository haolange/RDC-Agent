import { z } from 'zod';
import { ipcId, ipcNonEmptyString, ipcString } from './IpcPayloadGuard';

export const CommandListArgsSchema = z.tuple([
  ipcString(64, 'category').optional(),
]);

export const CommandExecuteArgsSchema = z.tuple([
  z.object({
    input: ipcNonEmptyString(8_000, 'input'),
    context: z.object({
      sessionId: ipcId(128, 'sessionId').optional(),
      projectId: ipcId(128, 'projectId').optional(),
      workspaceRoot: ipcString(4096, 'workspaceRoot').optional(),
      agentId: ipcString(200, 'agentId').optional(),
      currentMode: ipcString(64, 'currentMode').optional(),
      currentModelId: ipcString(200, 'currentModelId').optional(),
      currentTheme: ipcString(64, 'currentTheme').optional(),
    }).strict().optional(),
  }).strict(),
]);
