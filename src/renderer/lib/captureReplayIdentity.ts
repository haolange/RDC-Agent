import type { CaptureReplayState } from '@shared/types/captureReplay';
import type { SessionScope } from '@shared/types/session';

export function acceptsReplayState(current: CaptureReplayState | null, next: CaptureReplayState, scope: SessionScope) {
  return next.projectId === scope.projectId && next.sessionId === scope.sessionId
    && (!current || next.generation > current.generation || (next.generation === current.generation && next.revision >= current.revision));
}
