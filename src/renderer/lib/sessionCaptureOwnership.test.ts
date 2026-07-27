import { describe, expect, it } from 'vitest';
import type { ContextSnapshot, OpenedCaptureState } from '@shared/types/session';
import { isContextSnapshotOwnedBySession, isOpenedCaptureOwnedBySession } from './sessionCaptureOwnership';

const openedCapture = {
  projectId: 'project-a', ownerSessionId: 'session-a', inputId: 'input-a', filePath: 'capture.rdc', captureId: 'capture-a', sessionId: 'rdx-replay-session', contextId: 'context-a', replaySessionId: 'rdx-replay-session', backend: 'local', deviceId: 'local', deviceLabel: 'Local', status: 'open', openedAt: 1,
} satisfies OpenedCaptureState;

const snapshot = {
  contextId: 'context-a', sessionId: 'rdx-replay-session', ownerSessionId: 'session-a', backend: 'local', runtimeOwner: 'rdc-agent', ownerLeaseId: 'lease-a', captureDescriptors: [], activeCapture: 'capture-a', deviceLabel: 'Local',
} satisfies ContextSnapshot;

describe('session capture ownership', () => {
  it('accepts only the current app session owner', () => {
    expect(isOpenedCaptureOwnedBySession(openedCapture, 'project-a', 'session-a')).toBe(true);
    expect(isOpenedCaptureOwnedBySession(openedCapture, 'project-a', 'session-b')).toBe(false);
    expect(isOpenedCaptureOwnedBySession(openedCapture, 'project-b', 'session-a')).toBe(false);
  });

  it('does not treat the RDX replay session id as the app session owner', () => {
    expect(isOpenedCaptureOwnedBySession(openedCapture, 'project-a', 'rdx-replay-session')).toBe(false);
    expect(isContextSnapshotOwnedBySession(snapshot, 'rdx-replay-session')).toBe(false);
  });

  it('matches context snapshots through ownerSessionId only', () => {
    expect(isContextSnapshotOwnedBySession(snapshot, 'session-a')).toBe(true);
    expect(isContextSnapshotOwnedBySession(snapshot, 'session-b')).toBe(false);
  });
});