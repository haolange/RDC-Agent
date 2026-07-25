import { z } from 'zod';
import { ipcId, ipcNonEmptyString } from './IpcPayloadGuard';

export const ContextOpenHumanPreviewArgsSchema = z.tuple([
  z.object({
    sessionId: ipcId(128, 'sessionId').optional(),
  }).strict().optional(),
]);

export const CaptureOpenProjectInputArgsSchema = z.tuple([
  z.object({
    projectId: ipcId(128, 'projectId'),
    ownerSessionId: z.union([ipcId(128, 'ownerSessionId'), z.null()]),
    inputId: ipcNonEmptyString(200, 'inputId'),
    filePath: ipcNonEmptyString(4096, 'filePath'),
    replayDeviceId: ipcId(128, 'replayDeviceId'),
  }).strict(),
]);

export const CaptureSelectArgsSchema = z.tuple([
  ipcId(128, 'captureId'),
]);

export const DeviceActivateArgsSchema = z.tuple([
  ipcId(128, 'deviceId'),
]);
