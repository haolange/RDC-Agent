/**
 * Session-level artifact quota ledger: in-memory reservations + persisted snapshot.
 * Disk walk is authoritative on reconcile so crashed reservations cannot leak.
 */

import * as fs from 'fs';
import * as path from 'path';
import { generateShortId } from '@shared/utils/id';
import { SessionArtifactError } from '@shared/types/sessionArtifact';

export const SESSION_ARTIFACT_QUOTA_FILENAME = '.quota.json';

export interface SessionArtifactQuotaSnapshot {
  diskBytes: number;
  reservedBytes: number;
  liveBytes: number;
  diskToolOutputFiles: number;
  reservedToolOutputFiles: number;
  liveToolOutputFiles: number;
}

export interface SessionArtifactReservation {
  id: string;
  artifactsRoot: string;
  incomingBytes: number;
  existingBytes: number;
  deltaBytes: number;
  extraFiles: number;
}

interface LedgerState {
  reservedBytes: number;
  reservedToolOutputFiles: number;
  reservations: Map<string, SessionArtifactReservation>;
}

interface PersistedQuotaDocument {
  schemaVersion: '1';
  committedBytes: number;
  committedToolOutputFiles: number;
  reservations: Array<{
    id: string;
    incomingBytes: number;
    existingBytes: number;
    deltaBytes: number;
    extraFiles: number;
  }>;
}

const ledgers = new Map<string, LedgerState>();

function ledgerKey(artifactsRoot: string): string {
  return path.resolve(artifactsRoot);
}

function getState(artifactsRoot: string): LedgerState {
  const key = ledgerKey(artifactsRoot);
  let state = ledgers.get(key);
  if (!state) {
    state = { reservedBytes: 0, reservedToolOutputFiles: 0, reservations: new Map() };
    ledgers.set(key, state);
  }
  return state;
}

function quotaPath(artifactsRoot: string): string {
  return path.join(path.resolve(artifactsRoot), SESSION_ARTIFACT_QUOTA_FILENAME);
}

function persistLedger(artifactsRoot: string, disk: { bytes: number; toolOutputFiles: number }): void {
  const state = getState(artifactsRoot);
  const root = path.resolve(artifactsRoot);
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
  }
  const document: PersistedQuotaDocument = {
    schemaVersion: '1',
    committedBytes: disk.bytes,
    committedToolOutputFiles: disk.toolOutputFiles,
    reservations: [...state.reservations.values()].map((reservation) => ({
      id: reservation.id,
      incomingBytes: reservation.incomingBytes,
      existingBytes: reservation.existingBytes,
      deltaBytes: reservation.deltaBytes,
      extraFiles: reservation.extraFiles,
    })),
  };
  const target = quotaPath(artifactsRoot);
  const temporaryPath = `${target}.${process.pid}.${generateShortId()}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(document)}\n`, 'utf8');
  try {
    fs.renameSync(temporaryPath, target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST' || code === 'EPERM') {
      try {
        fs.rmSync(target, { force: true });
        fs.renameSync(temporaryPath, target);
        return;
      } catch (replaceError) {
        if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
        throw replaceError;
      }
    }
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

export function isSessionArtifactQuotaBookkeeping(filePath: string): boolean {
  const name = path.basename(filePath);
  if (name === SESSION_ARTIFACT_QUOTA_FILENAME) return true;
  return name.toLowerCase().endsWith('.tmp');
}

export function resetSessionArtifactQuotaLedger(): void {
  ledgers.clear();
}

export function getSessionArtifactQuotaSnapshot(
  artifactsRoot: string,
  disk: { bytes: number; toolOutputFiles: number },
): SessionArtifactQuotaSnapshot {
  const state = getState(artifactsRoot);
  return {
    diskBytes: disk.bytes,
    reservedBytes: state.reservedBytes,
    liveBytes: disk.bytes + state.reservedBytes,
    diskToolOutputFiles: disk.toolOutputFiles,
    reservedToolOutputFiles: state.reservedToolOutputFiles,
    liveToolOutputFiles: disk.toolOutputFiles + state.reservedToolOutputFiles,
  };
}

export function replaceSessionArtifactQuotaFromDisk(
  artifactsRoot: string,
  disk: { bytes: number; toolOutputFiles: number },
): SessionArtifactQuotaSnapshot {
  const key = ledgerKey(artifactsRoot);
  ledgers.set(key, { reservedBytes: 0, reservedToolOutputFiles: 0, reservations: new Map() });
  persistLedger(artifactsRoot, disk);
  return getSessionArtifactQuotaSnapshot(artifactsRoot, disk);
}

export function reserveSessionArtifactQuota(input: {
  artifactsRoot: string;
  diskBytes: number;
  diskToolOutputFiles: number;
  incomingBytes: number;
  existingBytes: number;
  extraFiles: number;
  maxSessionBytes: number;
  maxToolOutputFiles: number;
}): SessionArtifactReservation {
  const state = getState(input.artifactsRoot);
  const deltaBytes = Math.max(0, input.incomingBytes - input.existingBytes);
  const extraFiles = Math.max(0, input.extraFiles);
  const nextBytes = input.diskBytes + state.reservedBytes + deltaBytes;
  if (nextBytes > input.maxSessionBytes) {
    throw new SessionArtifactError(
      'ARTIFACT_QUOTA_EXCEEDED',
      `session artifacts would be ${nextBytes} bytes (cap ${input.maxSessionBytes}).`,
    );
  }
  const nextFiles = input.diskToolOutputFiles + state.reservedToolOutputFiles + extraFiles;
  if (extraFiles > 0 && nextFiles > input.maxToolOutputFiles) {
    throw new SessionArtifactError(
      'ARTIFACT_QUOTA_EXCEEDED',
      `tool-outputs would have ${nextFiles} files (cap ${input.maxToolOutputFiles}).`,
    );
  }
  const reservation: SessionArtifactReservation = {
    id: `res-${process.pid}-${generateShortId()}`,
    artifactsRoot: ledgerKey(input.artifactsRoot),
    incomingBytes: input.incomingBytes,
    existingBytes: input.existingBytes,
    deltaBytes,
    extraFiles,
  };
  state.reservations.set(reservation.id, reservation);
  state.reservedBytes += deltaBytes;
  state.reservedToolOutputFiles += extraFiles;
  persistLedger(input.artifactsRoot, {
    bytes: input.diskBytes,
    toolOutputFiles: input.diskToolOutputFiles,
  });
  return reservation;
}

export function commitSessionArtifactReservation(
  reservation: SessionArtifactReservation,
  disk: { bytes: number; toolOutputFiles: number },
): void {
  releaseReservation(reservation);
  persistLedger(reservation.artifactsRoot, disk);
}

export function rollbackSessionArtifactReservation(
  reservation: SessionArtifactReservation,
  disk: { bytes: number; toolOutputFiles: number },
): void {
  releaseReservation(reservation);
  persistLedger(reservation.artifactsRoot, disk);
}

function releaseReservation(reservation: SessionArtifactReservation): void {
  const state = getState(reservation.artifactsRoot);
  if (!state.reservations.delete(reservation.id)) return;
  state.reservedBytes = Math.max(0, state.reservedBytes - reservation.deltaBytes);
  state.reservedToolOutputFiles = Math.max(0, state.reservedToolOutputFiles - reservation.extraFiles);
}
