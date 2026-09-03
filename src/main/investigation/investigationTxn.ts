import * as fs from 'fs';
import * as path from 'path';
import { generateEventId } from '@shared/utils/id';
import { StorageIo } from '../sessions/StorageIo';
import { withDirectoryFileLockSync } from '../sessions/directoryFileLock';
import { InvestigationError, toInvestigationError } from './investigationErrors';
import { hashesEqual, sha256Prefixed } from './investigationHash';

export const INVESTIGATION_TXN_DIR = '.investigation-txn';
export const INVESTIGATION_TXN_JOURNAL = 'journal.json';
export const INVESTIGATION_TXN_COMMIT = 'COMMIT';
export const INVESTIGATION_TXN_LOCK = 'investigation.txn.lock';
export const INVESTIGATION_TXN_STAGING = 'staging';
export const INVESTIGATION_TXN_LOCK_TIMEOUT = 'INVESTIGATION_TXN_LOCK_TIMEOUT';

export const INVESTIGATION_PERSIST_BOUNDARIES = [
  'journal',
  'temp:content',
  'temp:manifest',
  'temp:supersede',
  'temp:stale',
  'temp:index',
  'commit-marker',
  'replace:content',
  'replace:manifest',
  'replace:supersede',
  'replace:stale',
  'replace:index',
  'cleanup',
] as const;

export type InvestigationPersistBoundary = (typeof INVESTIGATION_PERSIST_BOUNDARIES)[number];
export type InvestigationTxnRole = 'content' | 'manifest' | 'index' | 'supersede' | 'stale';

export interface InvestigationTxnMutation {
  uri: string;
  text: string;
  role: InvestigationTxnRole;
}

export interface InvestigationTxnPlanEntry {
  uri: string;
  role: InvestigationTxnRole;
  contentHash: string;
  stagingName: string;
}

export interface InvestigationTxnJournal {
  schemaVersion: 1;
  txnId: string;
  sessionId: string;
  createdAt: string;
  mutations: InvestigationTxnPlanEntry[];
}

export interface InvestigationTxnCommitMarker {
  schemaVersion: 1;
  txnId: string;
  mutationCount: number;
  planHash: string;
  mutations: InvestigationTxnPlanEntry[];
}

export const INVESTIGATION_TXN_ROLES = ['content', 'manifest', 'index', 'supersede', 'stale'] as const;

const CONTENT_HASH_RE = /^sha256:[0-9a-f]{64}$/i;

export interface InvestigationTxnIo {
  resolve(sessionId: string, uri: string): { sessionPath: string; absolutePath: string };
  write(sessionId: string, uri: string, text: string): { hash: string };
}

export interface InvestigationTxnHooks {
  onPersistBoundary?: (boundary: InvestigationPersistBoundary, info: {
    txnId: string;
    uri?: string;
    role?: InvestigationTxnRole;
  }) => void;
}

export type InvestigationTxnRecovery = 'none' | 'rolled-back' | 'rolled-forward';

const storageIo = new StorageIo();

export function investigationTxnRoot(sessionPath: string): string {
  return path.join(sessionPath, INVESTIGATION_TXN_DIR);
}

export function hasInvestigationTxnResidue(sessionPath: string): boolean {
  const root = investigationTxnRoot(sessionPath);
  if (!fs.existsSync(root)) return false;
  try {
    return fs.readdirSync(root).some((name) => name !== INVESTIGATION_TXN_LOCK);
  } catch {
    return false;
  }
}

export function withInvestigationTxnLock<T>(
  sessionPath: string,
  operation: () => T,
  options?: { maxAttempts?: number },
): T {
  try {
    return withDirectoryFileLockSync(investigationTxnRoot(sessionPath), {
      lockFileName: INVESTIGATION_TXN_LOCK,
      timeoutCode: INVESTIGATION_TXN_LOCK_TIMEOUT,
      ...(options?.maxAttempts != null ? { maxAttempts: options.maxAttempts } : {}),
    }, operation);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith(INVESTIGATION_TXN_LOCK_TIMEOUT)) {
      throw new InvestigationError('INVESTIGATION_STORAGE_FAILED', message, {
        details: { timeoutCode: INVESTIGATION_TXN_LOCK_TIMEOUT },
      });
    }
    throw toInvestigationError(error);
  }
}

export function commitInvestigationTxn(
  sessionId: string,
  mutations: InvestigationTxnMutation[],
  io: InvestigationTxnIo,
  hooks: InvestigationTxnHooks = {},
): void {
  const ordered = orderMutations(dedupeMutations(mutations));
  if (ordered.length === 0) return;
  const sessionPath = io.resolve(sessionId, ordered[0]!.uri).sessionPath;
  const txnId = generateEventId('invtxn');
  const plan = ordered.map((mutation, index) => toPlanEntry(mutation, index));
  const journal: InvestigationTxnJournal = {
    schemaVersion: 1,
    txnId,
    sessionId,
    createdAt: new Date().toISOString(),
    mutations: plan,
  };
  writeTxnDocument(sessionPath, INVESTIGATION_TXN_JOURNAL, journal);
  emitBoundary(hooks, 'journal', { txnId });
  const stagingDir = path.join(investigationTxnRoot(sessionPath), INVESTIGATION_TXN_STAGING);
  storageIo.ensureDir(stagingDir);
  for (const [index, mutation] of ordered.entries()) {
    const entry = plan[index]!;
    storageIo.writeUtf8AtomicFsync(path.join(stagingDir, entry.stagingName), mutation.text);
    emitBoundary(hooks, `temp:${mutation.role}`, { txnId, uri: mutation.uri, role: mutation.role });
  }
  const commit: InvestigationTxnCommitMarker = {
    schemaVersion: 1,
    txnId,
    mutationCount: plan.length,
    planHash: planHashOf(plan),
    mutations: plan,
  };
  writeTxnDocument(sessionPath, INVESTIGATION_TXN_COMMIT, commit);
  emitBoundary(hooks, 'commit-marker', { txnId });
  applyPlan(sessionId, ordered, io, hooks, txnId);
  cleanupTxn(sessionPath);
  emitBoundary(hooks, 'cleanup', { txnId });
}

export function recoverInvestigationTxn(
  sessionId: string,
  io: InvestigationTxnIo,
  hooks: InvestigationTxnHooks = {},
): InvestigationTxnRecovery {
  let sessionPath: string;
  try {
    sessionPath = io.resolve(sessionId, 'session://investigation/index.json').sessionPath;
  } catch (error) {
    throw toInvestigationError(error);
  }
  const root = investigationTxnRoot(sessionPath);
  const journalPath = path.join(root, INVESTIGATION_TXN_JOURNAL);
  const commitPath = path.join(root, INVESTIGATION_TXN_COMMIT);
  const stagingDir = path.join(root, INVESTIGATION_TXN_STAGING);
  const journalExists = fs.existsSync(journalPath);
  const commitExists = fs.existsSync(commitPath);
  const stagingExists = fs.existsSync(stagingDir) && directoryHasFiles(stagingDir);
  if (!journalExists && !commitExists && !stagingExists) {
    return 'none';
  }
  const journal = journalExists ? parseJournalDocument(readTxnFile(journalPath), sessionId) : null;
  const commit = commitExists ? parseCommitDocument(readTxnFile(commitPath)) : null;
  if (commitExists && !commit) {
    throw degraded('investigation commit marker is corrupt');
  }
  if (journalExists && !journal) {
    throw degraded('investigation journal is corrupt or incomplete');
  }
  if (commit) {
    if (journal && !journalMatchesCommit(journal, commit)) {
      throw degraded('investigation journal and commit marker are inconsistent');
    }
    const texts = readStagingTexts(sessionPath, commit.mutations);
    applyPlan(sessionId, texts, io, hooks, commit.txnId);
    cleanupTxn(sessionPath);
    return 'rolled-forward';
  }
  if (!journal) {
    throw degraded('investigation txn residue has no complete journal');
  }
  if (!liveMutationsUnapplied(sessionId, io, journal.mutations)) {
    throw degraded('investigation journal cannot prove mutations were unapplied');
  }
  cleanupTxn(sessionPath);
  return 'rolled-back';
}

function readStagingTexts(
  sessionPath: string,
  plan: InvestigationTxnPlanEntry[],
): InvestigationTxnMutation[] {
  const stagingDir = path.join(investigationTxnRoot(sessionPath), INVESTIGATION_TXN_STAGING);
  return plan.map((entry) => {
    const stagedPath = path.join(stagingDir, entry.stagingName);
    if (!fs.existsSync(stagedPath)) {
      throw new InvestigationError(
        'INVESTIGATION_DEGRADED',
        `missing staging file for ${entry.uri}`,
      );
    }
    const text = fs.readFileSync(stagedPath, 'utf8');
    if (sha256Prefixed(text) !== entry.contentHash) {
      throw new InvestigationError(
        'INVESTIGATION_DEGRADED',
        `staging hash drifted for ${entry.uri}`,
      );
    }
    return { uri: entry.uri, text, role: entry.role };
  });
}

function applyPlan(
  sessionId: string,
  mutations: InvestigationTxnMutation[],
  io: InvestigationTxnIo,
  hooks: InvestigationTxnHooks,
  txnId: string,
): void {
  for (const mutation of mutations) {
    const written = io.write(sessionId, mutation.uri, mutation.text);
    if (!hashesEqual(written.hash, sha256Prefixed(mutation.text))) {
      throw new InvestigationError('INVESTIGATION_HASH_MISMATCH', `txn replace hash drifted for ${mutation.uri}`);
    }
    emitBoundary(hooks, `replace:${mutation.role}`, {
      txnId,
      uri: mutation.uri,
      role: mutation.role,
    });
  }
}

function cleanupTxn(sessionPath: string): void {
  const root = investigationTxnRoot(sessionPath);
  const stagingDir = path.join(root, INVESTIGATION_TXN_STAGING);
  if (fs.existsSync(stagingDir)) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
  for (const name of [INVESTIGATION_TXN_JOURNAL, INVESTIGATION_TXN_COMMIT]) {
    const target = path.join(root, name);
    if (fs.existsSync(target)) fs.rmSync(target, { force: true });
  }
}

function writeTxnDocument(sessionPath: string, name: string, value: unknown): void {
  const root = investigationTxnRoot(sessionPath);
  storageIo.ensureDir(root);
  storageIo.writeUtf8AtomicFsync(path.join(root, name), `${JSON.stringify(value)}\n`);
}

function readTxnFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

function planHashOf(mutations: InvestigationTxnPlanEntry[]): string {
  return sha256Prefixed(JSON.stringify(mutations));
}

function parseJournalDocument(raw: string, sessionId: string): InvestigationTxnJournal | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (parsed.schemaVersion !== 1) return null;
  if (!nonEmptyString(parsed.txnId) || !nonEmptyString(parsed.sessionId) || !nonEmptyString(parsed.createdAt)) {
    return null;
  }
  if (parsed.sessionId !== sessionId) return null;
  const mutations = parseMutations(parsed.mutations);
  if (!mutations) return null;
  return {
    schemaVersion: 1,
    txnId: parsed.txnId,
    sessionId: parsed.sessionId,
    createdAt: parsed.createdAt,
    mutations,
  };
}

function parseCommitDocument(raw: string): InvestigationTxnCommitMarker | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (parsed.schemaVersion !== 1 || !nonEmptyString(parsed.txnId)) return null;
  const mutations = parseMutations(parsed.mutations);
  if (!mutations) return null;
  if (parsed.mutationCount !== mutations.length) return null;
  if (!nonEmptyString(parsed.planHash) || parsed.planHash !== planHashOf(mutations)) return null;
  return {
    schemaVersion: 1,
    txnId: parsed.txnId,
    mutationCount: mutations.length,
    planHash: parsed.planHash,
    mutations,
  };
}

function parseMutations(value: unknown): InvestigationTxnPlanEntry[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const stagingNames = new Set<string>();
  const uris = new Set<string>();
  const mutations: InvestigationTxnPlanEntry[] = [];
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) return null;
    if (!nonEmptyString(item.uri) || item.uri.includes('\\') || item.uri.includes('..')) return null;
    if (!isTxnRole(item.role)) return null;
    if (!nonEmptyString(item.contentHash) || !CONTENT_HASH_RE.test(item.contentHash)) return null;
    if (!isSafeStagingName(item.stagingName, item.role, index)) return null;
    if (uris.has(item.uri) || stagingNames.has(item.stagingName)) return null;
    uris.add(item.uri);
    stagingNames.add(item.stagingName);
    mutations.push({
      uri: item.uri,
      role: item.role,
      contentHash: item.contentHash,
      stagingName: item.stagingName,
    });
  }
  return mutations;
}

function journalMatchesCommit(journal: InvestigationTxnJournal, commit: InvestigationTxnCommitMarker): boolean {
  return journal.txnId === commit.txnId && planHashOf(journal.mutations) === commit.planHash;
}

function liveMutationsUnapplied(
  sessionId: string,
  io: InvestigationTxnIo,
  mutations: InvestigationTxnPlanEntry[],
): boolean {
  for (const entry of mutations) {
    let absolutePath: string;
    try {
      absolutePath = io.resolve(sessionId, entry.uri).absolutePath;
    } catch {
      return false;
    }
    if (!fs.existsSync(absolutePath)) continue;
    const text = fs.readFileSync(absolutePath, 'utf8');
    if (hashesEqual(sha256Prefixed(text), entry.contentHash)) return false;
  }
  return true;
}

function isTxnRole(value: unknown): value is InvestigationTxnRole {
  return typeof value === 'string' && (INVESTIGATION_TXN_ROLES as readonly string[]).includes(value);
}

function isSafeStagingName(value: unknown, role: InvestigationTxnRole, index: number): value is string {
  if (typeof value !== 'string' || !value || value.includes('..') || value.includes('/') || value.includes('\\')) {
    return false;
  }
  return value === `${String(index).padStart(3, '0')}-${role}.json`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function degraded(message: string): InvestigationError {
  return new InvestigationError('INVESTIGATION_DEGRADED', message);
}

function toPlanEntry(mutation: InvestigationTxnMutation, index: number): InvestigationTxnPlanEntry {
  return {
    uri: mutation.uri,
    role: mutation.role,
    contentHash: sha256Prefixed(mutation.text),
    stagingName: `${String(index).padStart(3, '0')}-${mutation.role}.json`,
  };
}

function dedupeMutations(mutations: InvestigationTxnMutation[]): InvestigationTxnMutation[] {
  const byUri = new Map<string, InvestigationTxnMutation>();
  for (const mutation of mutations) {
    byUri.set(mutation.uri, mutation);
  }
  return [...byUri.values()];
}

function orderMutations(mutations: InvestigationTxnMutation[]): InvestigationTxnMutation[] {
  const rest = mutations.filter((mutation) => mutation.role !== 'index');
  return [...rest, ...mutations.filter((mutation) => mutation.role === 'index')];
}

function directoryHasFiles(dir: string): boolean {
  try {
    return fs.readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

function emitBoundary(
  hooks: InvestigationTxnHooks,
  boundary: InvestigationPersistBoundary,
  info: { txnId: string; uri?: string; role?: InvestigationTxnRole },
): void {
  hooks.onPersistBoundary?.(boundary, info);
}
