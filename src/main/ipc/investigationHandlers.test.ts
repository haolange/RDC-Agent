import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InvestigationError } from '../investigation/investigationErrors';
import { SessionArtifactError } from '@shared/types/sessionArtifact';
import { IpcValidationError } from './validation/IpcPayloadGuard';

const { handle, readRecord, readSession } = vi.hoisted(() => ({
  handle: vi.fn(),
  readRecord: vi.fn(),
  readSession: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: { handle },
}));

vi.mock('../investigation/InvestigationArtifactService', () => ({
  investigationArtifactService: { readRecord },
}));

vi.mock('../sessions/StorageAdapter', () => ({
  storageAdapter: { readSession },
}));

import { registerInvestigationHandlers } from './investigationHandlers';

const HASH = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER_HASH = 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function invoke(
  state: { currentSessionId: string | null; currentProjectId: string | null },
  args: unknown[],
) {
  registerInvestigationHandlers({
    state: { currentSessionId: state.currentSessionId, currentProjectId: state.currentProjectId, currentRunId: null },
  } as never);
  const registration = handle.mock.calls.find((call) => call[0] === 'investigation:read');
  if (!registration) throw new Error('handler not registered');
  return (registration[1] as (...raw: unknown[]) => Promise<unknown>)({}, ...args);
}

describe('investigation:read', () => {
  beforeEach(() => {
    handle.mockReset();
    readRecord.mockReset();
    readSession.mockReset();
    readSession.mockReturnValue({ sessionId: 'session-current', projectId: 'project-current' });
  });

  it('denies a session that is not current and does not read', async () => {
    const result = await invoke(
      { currentSessionId: 'session-current', currentProjectId: 'project-current' },
      [{ sessionId: 'session-other', artifactId: 'invart-1', expectedHash: HASH }],
    );
    expect(result).toMatchObject({
      ok: false,
      status: 'error',
      errorCode: 'INVESTIGATION_SESSION_DENIED',
    });
    expect(readRecord).not.toHaveBeenCalled();
  });

  it('denies a session that is not owned by the active project', async () => {
    readSession.mockReturnValue({ sessionId: 'session-current', projectId: 'project-other' });
    const result = await invoke(
      { currentSessionId: 'session-current', currentProjectId: 'project-current' },
      [{ sessionId: 'session-current', artifactId: 'invart-1', expectedHash: HASH }],
    );
    expect(result).toMatchObject({
      ok: false,
      status: 'error',
      errorCode: 'INVESTIGATION_SESSION_DENIED',
    });
    expect(readRecord).not.toHaveBeenCalled();
  });

  it('returns hash-mismatch when expectedHash drifts', async () => {
    readRecord.mockImplementation(() => {
      throw new InvestigationError('INVESTIGATION_HASH_MISMATCH', 'expectedHash does not match content');
    });
    const result = await invoke(
      { currentSessionId: 'session-current', currentProjectId: 'project-current' },
      [{ sessionId: 'session-current', artifactId: 'invart-1', expectedHash: OTHER_HASH }],
    );
    expect(result).toMatchObject({
      ok: false,
      status: 'hash-mismatch',
      errorCode: 'INVESTIGATION_HASH_MISMATCH',
    });
    expect(readRecord).toHaveBeenCalledWith('session-current', 'invart-1', OTHER_HASH);
  });

  it('returns degraded when the investigation store is corrupt', async () => {
    readRecord.mockImplementation(() => {
      throw new InvestigationError('INVESTIGATION_INDEX_CORRUPT', 'index is not JSON');
    });
    const result = await invoke(
      { currentSessionId: 'session-current', currentProjectId: 'project-current' },
      [{ sessionId: 'session-current', artifactId: 'invart-1', expectedHash: HASH }],
    );
    expect(result).toMatchObject({
      ok: false,
      status: 'degraded',
      errorCode: 'INVESTIGATION_INDEX_CORRUPT',
    });
  });

  it('fail-closes when the record exceeds max-bytes', async () => {
    readRecord.mockImplementation(() => {
      throw new SessionArtifactError('ARTIFACT_TOO_LARGE', '2097153 bytes exceeds 2097152 bytes.');
    });
    const result = await invoke(
      { currentSessionId: 'session-current', currentProjectId: 'project-current' },
      [{ sessionId: 'session-current', artifactId: 'invart-1', expectedHash: HASH }],
    );
    expect(result).toMatchObject({
      ok: false,
      status: 'error',
      errorCode: 'ARTIFACT_TOO_LARGE',
    });
  });

  it('rejects URI and absolute path payloads without calling readRecord', async () => {
    const cases = [
      { sessionId: 'session-current', artifactId: 'session://investigation/records/a.json', expectedHash: HASH },
      { sessionId: 'session-current', artifactId: 'D:\\records\\a.json', expectedHash: HASH },
      { sessionId: 'session-current', artifactId: 'invart-1', expectedHash: HASH, path: 'D:/escape.json' },
      { sessionId: 'session-current', artifactId: 'file:record', expectedHash: HASH },
      { sessionId: 'session-current', artifactId: 'http:record', expectedHash: HASH },
      { sessionId: 'session-current', artifactId: 'D:record', expectedHash: HASH },
      { sessionId: 'file:record', artifactId: 'invart-1', expectedHash: HASH },
      { sessionId: 'http:record', artifactId: 'invart-1', expectedHash: HASH },
      { sessionId: 'D:record', artifactId: 'invart-1', expectedHash: HASH },
    ];
    for (const payload of cases) {
      await expect(
        invoke(
          { currentSessionId: 'session-current', currentProjectId: 'project-current' },
          [payload],
        ),
      ).rejects.toBeInstanceOf(IpcValidationError);
    }
    expect(readRecord).not.toHaveBeenCalled();
  });

  it('returns the record for the active project and session', async () => {
    readRecord.mockReturnValue({
      manifest: { artifactId: 'invart-1', status: 'ready', title: 'World' },
      record: { worldStateId: 'ws-1' },
      contentHash: HASH,
      contentUri: 'session://investigation/records/invart-1.json',
    });
    const result = await invoke(
      { currentSessionId: 'session-current', currentProjectId: 'project-current' },
      [{ sessionId: 'session-current', artifactId: 'invart-1', expectedHash: HASH }],
    );
    expect(result).toEqual({
      ok: true,
      status: 'ready',
      manifest: { artifactId: 'invart-1', status: 'ready', title: 'World' },
      record: { worldStateId: 'ws-1' },
      contentHash: HASH,
    });
    expect(readRecord).toHaveBeenCalledTimes(1);
    expect(readRecord).toHaveBeenCalledWith('session-current', 'invart-1', HASH);
  });
});
