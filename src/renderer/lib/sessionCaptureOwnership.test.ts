import { describe, expect, it } from 'vitest';
import type { ContextSnapshot, OpenedCaptureState } from '@shared/types/session';
import { isContextSnapshotOwnedBySession, isOpenedCaptureOwnedBySession } from './sessionCaptureOwnership';

const openedCapture = {
  projectId: 'project-a', ownerSessionId: 'session-a', inputId: 'input-a', filePath: 'capture.rdc', captureId: 'capture-a', sessionId: 'rdc-replay-session', contextId: 'context-a', replaySessionId: 'rdc-replay-session', backend: 'local', deviceId: 'local', deviceLabel: 'Local', status: 'open', openedAt: 1,
} satisfies OpenedCaptureState;

const snapshot = {
  contextId: 'context-a', sessionId: 'rdc-replay-session', ownerSessionId: 'session-a', backend: 'local', runtimeOwner: 'rdc-agent', ownerLeaseId: 'lease-a', captureDescriptors: [], activeCapture: 'capture-a', deviceLabel: 'Local',
} satisfies ContextSnapshot;

describe('session capture ownership', () => {
  it('fails closed when no capture is open', () => {
    expect(isOpenedCaptureOwnedBySession(null, 'project-a', 'session-a')).toBe(false);
    expect(isOpenedCaptureOwnedBySession(undefined, 'project-a', 'session-a')).toBe(false);
    expect(isContextSnapshotOwnedBySession(null, 'session-a')).toBe(false);
  });

  it('accepts only the current app session owner', () => {
    expect(isOpenedCaptureOwnedBySession(openedCapture, 'project-a', 'session-a')).toBe(true);
    expect(isOpenedCaptureOwnedBySession(openedCapture, 'project-a', 'session-b')).toBe(false);
    expect(isOpenedCaptureOwnedBySession(openedCapture, 'project-b', 'session-a')).toBe(false);
  });

  it('does not treat the RDC replay session id as the app session owner', () => {
    expect(isOpenedCaptureOwnedBySession(openedCapture, 'project-a', 'rdc-replay-session')).toBe(false);
    expect(isContextSnapshotOwnedBySession(snapshot, 'rdc-replay-session')).toBe(false);
  });

  it('matches context snapshots through ownerSessionId only', () => {
    expect(isContextSnapshotOwnedBySession(snapshot, 'session-a')).toBe(true);
    expect(isContextSnapshotOwnedBySession(snapshot, 'session-b')).toBe(false);
  });
});