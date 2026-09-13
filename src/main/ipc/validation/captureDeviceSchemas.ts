import { z } from 'zod';
import { ipcId, ipcNonEmptyString } from './IpcPayloadGuard';

export const SessionScopeSchema = z.object({
  projectId: ipcId(128, 'projectId'),
  sessionId: ipcId(128, 'sessionId'),
}).strict();

export const SessionScopeArgsSchema = z.tuple([SessionScopeSchema]);

export const CaptureReplayBindingSchema = SessionScopeSchema.extend({ bindingGeneration: z.number().int().nonnegative() }).strict();
export const CaptureReplayBindingArgsSchema = z.tuple([CaptureReplayBindingSchema]);
export const CaptureReplayApplyArgsSchema = z.tuple([CaptureReplayBindingSchema.extend({
  eventId: z.number().int().nonnegative(),
  target: z.object({ textureId: z.string().max(256).optional(), outputSlot: z.number().int().nonnegative().optional() }).strict().optional(),
}).strict()]);

export const CaptureOpenProjectInputArgsSchema = z.tuple([
  CaptureReplayBindingSchema.extend({
    inputId: ipcNonEmptyString(200, 'inputId'),
    filePath: ipcNonEmptyString(4096, 'filePath'),
    replayDeviceId: ipcId(128, 'replayDeviceId'),
  }).strict(),
]);

export const CaptureSelectArgsSchema = z.tuple([
  CaptureReplayBindingSchema.extend({
    captureId: ipcId(128, 'captureId'),
  }).strict(),
]);

export const DeviceActivateArgsSchema = z.tuple([
  ipcId(128, 'deviceId'),
]);
