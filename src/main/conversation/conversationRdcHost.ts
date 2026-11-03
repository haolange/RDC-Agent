import type { ReplayDeviceEntry } from '@shared/types/device';
import type { OpenedCaptureState } from '@shared/types/session';

export interface ConversationRdcHost {
  acquirePreparationLock(sessionId: string, owner: string): void;
  setInteractionLock(sessionId: string, owner: string, locked: boolean): void;
  snapshotOpenedCapture(scope: { projectId: string; sessionId: string }): OpenedCaptureState | null;
  replayDevice(deviceId: string): ReplayDeviceEntry | null;
}

const idleHost: ConversationRdcHost = {
  acquirePreparationLock() {},
  setInteractionLock() {},
  snapshotOpenedCapture() { return null; },
  replayDevice() { return null; },
};

let host: ConversationRdcHost = idleHost;

export function registerConversationRdcHost(next: ConversationRdcHost): void {
  host = next;
}

export function conversationRdcHost(): ConversationRdcHost {
  return host;
}
