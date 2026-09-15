import type { SessionScope, OpenedCapturePreview } from './session';
export type CaptureReplayPhase = 'closed' | 'validating' | 'connecting' | 'transferring' | 'opening' | 'loading_image' | 'ready' | 'applying' | 'closing' | 'error';
export interface CaptureReplayEvent { eventId: number }
export interface CaptureReplayTarget { textureId: string; outputSlot: number | null }
export interface CaptureReplayError { code: string; message: string; retry: 'open' | 'close' | 'image' | 'apply' | null }
export interface CaptureReplayObservation {
  nativeRevision: number;
  modificationState: 'baseline' | 'intervention' | 'restored';
  displayParameters: { mip: number; slice: number; sample: number; rangeMin: number; rangeMax: number };
}
export interface CaptureAgentObservation {
  eventId: number; operationId: string; toolCallId: string; summary: string;
  image: OpenedCapturePreview; target: CaptureReplayTarget | null; observation: CaptureReplayObservation | null;
  saved: boolean; saveError: string | null;
}
export interface CaptureReplayState extends SessionScope {
  generation: number; revision: number; operationId: string | null; phase: CaptureReplayPhase;
  replayDeviceId: string | null; inputId: string | null; captureHash: string | null; contextId: string | null;
  requestedEventId: number | null; appliedEventId: number | null; imageEventId: number | null;
  events: CaptureReplayEvent[]; targets: CaptureReplayTarget[]; target: CaptureReplayTarget | null;
  isFinalOutput: boolean; image: OpenedCapturePreview | null;
  observation: CaptureReplayObservation | null;
  agentObservation: CaptureAgentObservation | null;
  devicePresentation: { status: 'not_applicable' | 'unsupported' | 'pending' | 'displayed' | 'error'; reason?: string };
  warning: { code: string; message: string } | null;
  interactionLock: string | null; error: CaptureReplayError | null;
}
export interface CaptureReplayBindingRequest extends SessionScope { bindingGeneration: number }
export interface CaptureReplayApplyRequest extends CaptureReplayBindingRequest { eventId: number; target?: { textureId?: string; outputSlot?: number } }

export interface CaptureReplayHistoryRequest extends SessionScope { captureHash: string; afterSequence?: number; limit?: number }
export interface CaptureReplayHistoryEntry {
  sequence: number; eventId: number | null; operationId: string; summary: string; timestamp: number; saved: true;
  imageSha256?: string; resourceId?: string; toolCallId?: string; modificationState?: string; failure?: string;
  nativeRevision?: number; displayParameters?: CaptureReplayObservation['displayParameters'];
}
export interface CaptureReplaySelection { inputId: string; captureSha256?: string; deviceId?: string }
