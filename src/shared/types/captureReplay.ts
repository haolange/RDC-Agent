import type { ErrorCode } from '../errors/errorCodes';
import type { SessionScope, OpenedCapturePreview } from './session';
import type { ReplayDeviceIssue, SessionDevicePreparation } from './device';
export type CaptureReplayPhase =
  | 'closed'
  | 'validating'
  | 'connecting'
  | 'transferring'
  | 'opening'
  | 'loading_image'
  | 'ready'
  | 'applying'
  | 'closing'
  | 'error';
interface CaptureReplayEvent {
  eventId: number;
}
export interface CaptureReplayTarget {
  textureId: string;
  outputSlot: number | null;
}
export interface CaptureReplayError {
  code: string;
  message: string;
  retry: 'open' | 'close' | 'image' | 'apply' | null;
  issue?: ReplayDeviceIssue;
}
interface CaptureReplayObservation {
  nativeRevision: number;
  modificationState: 'baseline' | 'intervention' | 'restored';
  displayParameters: { mip: number; slice: number; sample: number; rangeMin: number; rangeMax: number };
}
export interface CaptureReplayState extends SessionScope {
  preparation: SessionDevicePreparation;
  generation: number;
  revision: number;
  operationId: string | null;
  phase: CaptureReplayPhase;
  replayDeviceId: string | null;
  inputId: string | null;
  captureHash: string | null;
  contextId: string | null;
  requestedEventId: number | null;
  appliedEventId: number | null;
  imageEventId: number | null;
  events: CaptureReplayEvent[];
  targets: CaptureReplayTarget[];
  target: CaptureReplayTarget | null;
  isFinalOutput: boolean;
  image: OpenedCapturePreview | null;
  observation: CaptureReplayObservation | null;
  devicePresentation: {
    status: 'not_applicable' | 'unsupported' | 'unavailable' | 'presented';
    eventId: number | null;
    textureId: string | null;
    sequence: number | null;
    reason: string | null;
  };
  warning: { code: string; message: string } | null;
  interactionLock: string | null;
  error: CaptureReplayError | null;
}
export interface CaptureReplayBindingRequest extends SessionScope {
  bindingGeneration: number;
}
export interface DevicePreparationRequest extends CaptureReplayBindingRequest {
  deviceId: string;
  confirmationToken?: string;
}
export interface DevicePreparationResult {
  success: boolean;
  state: CaptureReplayState;
  confirmation?: { token: string; kind: 'close_capture' };
  error?: ReplayDeviceIssue;
}
export interface CaptureReplayApplyRequest extends CaptureReplayBindingRequest {
  eventId: number;
  target?: { textureId?: string; outputSlot?: number };
}

export interface CaptureReplaySelection {
  inputId: string;
  captureSha256?: string;
  deviceId?: string;
}

/** Who can make an unusable replay usable again: the agent's recovery, the user, or a restart of the app. */
export type CaptureExit = 'agent-recover' | 'ask-user' | 'restart';

/** Whether live capture work may run now; every surface that asks reads this one answer. */
export type CaptureReadiness = { state: 'ready' } | { state: 'blocked'; code: ErrorCode; exit: CaptureExit };

/**
 * What the Capture panel offers when the session's replay needs recovery: return to an unresolved signed position, or
 * rebuild a replay that failed with no such position to return to.
 */
export type CaptureRecoveryStatus =
  | {
      kind: 'restore';
      pendingCount: number;
      original: { inputId: string; fileName: string; deviceId: string; eventId: number } | null;
    }
  | { kind: 'rebuild'; input: { inputId: string; fileName: string; deviceId: string } };
