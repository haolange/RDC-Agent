import type { MissionKind } from '@shared/types/session';
import { storageAdapter } from '../StorageAdapter';

export function readPersistedRunOrThrow(sessionId: string, runId: string) {
  const run = storageAdapter.readPersistedRun(sessionId, runId);
  if (!run) {
    throw new Error(`RUN_NOT_FOUND: ${sessionId}/${runId}`);
  }
  return run;
}

export function assertMissionRun(sessionId: string, runId: string, mission?: MissionKind): void {
  const run = readPersistedRunOrThrow(sessionId, runId);
  if (run.kind !== 'mission') {
    throw new Error(`MISSION_RUN_REQUIRED: conversation run ${runId} cannot consume investigation sidecars.`);
  }
  if (mission && run.mission !== mission) {
    throw new Error(`MISSION_KIND_MISMATCH: run ${runId} is ${run.mission}, expected ${mission}.`);
  }
}
