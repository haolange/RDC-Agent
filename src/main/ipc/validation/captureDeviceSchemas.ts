import { z } from 'zod';
import { ipcId, ipcNonEmptyString } from './IpcPayloadGuard';

export const SessionScopeSchema = z.object({
  projectId: ipcId(128, 'projectId'),
  sessionId: ipcId(128, 'sessionId'),
}).strict();

export const SessionScopeArgsSchema = z.tuple([SessionScopeSchema]);

export const ContextOpenHumanPreviewArgsSchema = SessionScopeArgsSchema;

export const CaptureOpenProjectInputArgsSchema = z.tuple([
  SessionScopeSchema.extend({
    inputId: ipcNonEmptyString(200, 'inputId'),
    filePath: ipcNonEmptyString(4096, 'filePath'),
    replayDeviceId: ipcId(128, 'replayDeviceId'),
  }).strict(),
]);

export const CaptureSelectArgsSchema = z.tuple([
  SessionScopeSchema.extend({
    captureId: ipcId(128, 'captureId'),
  }).strict(),
]);

export const DeviceActivateArgsSchema = z.tuple([
  ipcId(128, 'deviceId'),
]);
