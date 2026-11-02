import type { CaptureReplayState } from '@shared/types/captureReplay';

export function replayFixture(overrides: Partial<CaptureReplayState> = {}): CaptureReplayState {
  return {
    projectId: 'project', sessionId: 'session', generation: 1, revision: 1, operationId: null,
    phase: 'closed', preparation: { targetDeviceId: 'local', phase: 'ready', issue: null },
    replayDeviceId: 'local', inputId: null, captureHash: null, contextId: null,
    requestedEventId: null, appliedEventId: null, imageEventId: null, events: [], targets: [], target: null,
    isFinalOutput: false, image: null, observation: null,
    devicePresentation: { status: 'not_applicable', eventId: null, textureId: null, sequence: null, reason: null },
    warning: null, interactionLock: null, error: null, ...overrides,
  };
}
