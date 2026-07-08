import type { ContextSnapshot, OpenedCaptureState } from '@shared/types/session';

export function isOpenedCaptureOwnedBySession(
  openedCapture: OpenedCaptureState | null | undefined,
  projectId: string | null | undefined,
  sessionId: string | null | undefined,
): boolean {
  return Boolean(
    openedCapture
    && projectId
    && sessionId
    && openedCapture.projectId === projectId
    && openedCapture.ownerSessionId === sessionId,
  );
}

export function isContextSnapshotOwnedBySession(
  snapshot: ContextSnapshot | null | undefined,
  sessionId: string | null | undefined,
): boolean {
  return Boolean(snapshot && sessionId && snapshot.ownerSessionId === sessionId);
}