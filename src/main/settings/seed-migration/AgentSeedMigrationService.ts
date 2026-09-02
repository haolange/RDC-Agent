import fs from 'fs';
import os from 'os';
import path from 'path';
import { z } from 'zod';
import { StorageIo } from '../../sessions/StorageIo';
import { withDirectoryFileLockSync } from '../../sessions/directoryFileLock';
import { parseStoredDocument, type StorageMigration } from '../../sessions/storageSchema';
import { extractSeedSemanticManifest, hashSeedSemanticManifest, readSeedFrontmatterId } from './semanticHash';
import { expandOfficialS0IdAliases, officialSeedHashIndex, officialSeedIdentitySet } from './officialSeedGenerations';

export const SEED_MIGRATION_MARKER_NAME = '.seed-migration.json';
export const SEED_MIGRATED_DIR_NAME = '.migrated';
export const BUILTIN_SEED_AGENT_IDS = ['general', 'debugger', 'analyzer', 'optimizer'] as const;

const PurgedSeedSchema = z.object({
  id: z.string(),
  generationId: z.string(),
  sourceHash: z.string(),
}).strict();

const RetainedSeedSchema = z.object({
  id: z.string(),
  reason: z.enum(['user-modified', 'unknown-custom', 'target-hash-conflict']),
  sourceHash: z.string(),
}).strict();

const SeedMigrationMarkerV1Schema = z.object({
  schemaVersion: z.literal('1'),
  completedAt: z.string(),
  diagnostics: z.array(z.string()),
  purged: z.array(PurgedSeedSchema).default([]),
  retained: z.array(RetainedSeedSchema),
  moved: z.array(PurgedSeedSchema.extend({ archivedPath: z.string() })).optional(),
}).strict();

export type SeedMigrationMarker = z.infer<typeof SeedMigrationMarkerV1Schema>;

export const SEED_MIGRATION_MARKER_MIGRATIONS: StorageMigration<SeedMigrationMarker>[] = [
  { schemaVersion: '1', schema: SeedMigrationMarkerV1Schema },
];

const idFromFileName = (fileName: string): string => fileName.replace(/\.agent\.md$/u, '');

export function collectSeedMigrationCandidateIds(fileName: string, raw: string): string[] {
  const fileId = idFromFileName(fileName);
  const frontmatterId = readSeedFrontmatterId(raw);
  const ordered = [frontmatterId, fileId].filter((entry): entry is string => Boolean(entry?.trim()));
  const seen = new Set<string>();
  const candidates: string[] = [];
  const push = (id: string) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    candidates.push(id);
  };
  for (const id of ordered) {
    push(id);
    for (const alias of expandOfficialS0IdAliases(id)) {
      push(alias);
    }
  }
  return candidates;
}

export interface SeedMigrationResult {
  marker: SeedMigrationMarker;
  alreadyComplete: boolean;
}

export interface AgentSeedMigrationOptions {
  maxAttempts?: number;
  builtinAgentsPath?: string;
}

function defaultBuiltinAgentsPath(): string {
  return path.resolve(process.cwd(), 'resources', 'agent-runtime', 'agents');
}

export class AgentSeedMigrationService {
  constructor(
    private readonly io = new StorageIo(),
    private readonly lockOptions: AgentSeedMigrationOptions = {},
  ) {}

  migrateUserAgents(agentsPath: string): SeedMigrationResult {
    this.io.ensureDir(agentsPath);
    return withDirectoryFileLockSync(
      agentsPath,
      {
        lockFileName: '.seed-migration.lock',
        timeoutCode: 'SEED_MIGRATION_LOCK_TIMEOUT',
        maxAttempts: this.lockOptions.maxAttempts,
      },
      () => this.migrateUserAgentsLocked(agentsPath),
    );
  }

  private migrateUserAgentsLocked(agentsPath: string): SeedMigrationResult {
    const markerPath = path.join(agentsPath, SEED_MIGRATION_MARKER_NAME);
    const existing = this.readMarker(markerPath);
    if (existing) {
      const leftover = this.removeLeftoverMigratedDir(agentsPath);
      if (leftover.length > 0 && existing.diagnostics.every((entry) => !entry.startsWith('SEED_MIGRATION_LEFTOVER_MIGRATED'))) {
        existing.diagnostics.push(...leftover);
      }
      return { marker: existing, alreadyComplete: true };
    }

    const index = officialSeedHashIndex();
    const officialIds = officialSeedIdentitySet();
    const diagnostics: string[] = [];
    const purged: SeedMigrationMarker['purged'] = [];
    const retained: SeedMigrationMarker['retained'] = [];
    const entries = fs.existsSync(agentsPath)
      ? fs.readdirSync(agentsPath).filter((entry) => entry.endsWith('.agent.md'))
      : [];

    const userSnapshot = new Map<string, {
      hash: string;
      id: string;
      candidateIds: string[];
      official: { generationId: string } | null;
    }>();
    for (const entry of entries) {
      const sourcePath = path.join(agentsPath, entry);
      try {
        const raw = fs.readFileSync(sourcePath, 'utf8');
        const candidateIds = collectSeedMigrationCandidateIds(entry, raw);
        const fallbackId = candidateIds[0] ?? idFromFileName(entry);
        let matched: { id: string; hash: string; official: { generationId: string } } | null = null;
        let fallbackHash = '';
        for (const candidateId of candidateIds) {
          const hash = hashSeedSemanticManifest(extractSeedSemanticManifest(raw, candidateId));
          if (!fallbackHash) fallbackHash = hash;
          const official = index.get(hash);
          if (official) {
            matched = { id: candidateId, hash, official };
            break;
          }
        }
        userSnapshot.set(entry, {
          hash: matched?.hash ?? fallbackHash,
          id: matched?.id ?? fallbackId,
          candidateIds,
          official: matched?.official ?? null,
        });
      } catch (error) {
        diagnostics.push(`SEED_MIGRATION_READ_FAILED: ${sourcePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const isolateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rdx-seed-purge-'));
    const isolated: Array<{
      entry: string;
      sourcePath: string;
      isolatePath: string;
      id: string;
      sourceHash: string;
      generationId: string;
    }> = [];

    try {
      for (const entry of entries) {
        const sourcePath = path.join(agentsPath, entry);
        let raw: string;
        try {
          raw = fs.readFileSync(sourcePath, 'utf8');
        } catch (error) {
          diagnostics.push(`SEED_MIGRATION_READ_FAILED: ${sourcePath}: ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
        const snapshot = userSnapshot.get(entry);
        const candidates = snapshot?.candidateIds ?? collectSeedMigrationCandidateIds(entry, raw);
        const fallbackId = snapshot?.id ?? candidates[0] ?? idFromFileName(entry);
        const matched = snapshot?.official
          ? { id: snapshot.id, sourceHash: snapshot.hash, official: snapshot.official }
          : null;
        if (!matched) {
          const looksOfficial = candidates.some((candidateId) => officialIds.has(candidateId));
          retained.push({
            id: fallbackId,
            reason: looksOfficial ? 'user-modified' : 'unknown-custom',
            sourceHash: snapshot?.hash ?? hashSeedSemanticManifest(extractSeedSemanticManifest(raw, fallbackId)),
          });
          continue;
        }

        const { id, sourceHash, official } = matched;
        const reread = this.rereadSourceHash(sourcePath, id);
        if (!reread || reread.hash !== sourceHash) {
          if (snapshot && reread) {
            snapshot.hash = reread.hash;
          }
          retained.push({
            id,
            reason: 'user-modified',
            sourceHash: reread?.hash ?? sourceHash,
          });
          diagnostics.push(`SEED_MIGRATION_SOURCE_CHANGED: ${id} changed before isolate; left in place.`);
          continue;
        }

        const isolatePath = path.join(isolateRoot, entry);
        try {
          fs.renameSync(sourcePath, isolatePath);
        } catch (error) {
          diagnostics.push(`SEED_MIGRATION_ISOLATE_FAILED: ${id}: ${error instanceof Error ? error.message : String(error)}`);
          retained.push({ id, reason: 'user-modified', sourceHash: reread.hash });
          continue;
        }
        isolated.push({
          entry,
          sourcePath,
          isolatePath,
          id,
          sourceHash: reread.hash,
          generationId: official.generationId,
        });
      }

      const verifyDiagnostics = this.verifyAssetsIntact(agentsPath, userSnapshot, isolated);
      if (verifyDiagnostics.length > 0) {
        this.restoreIsolated(isolated, diagnostics);
        diagnostics.push(...verifyDiagnostics);
        throw new Error(`SEED_MIGRATION_VERIFY_FAILED: ${verifyDiagnostics.join(' | ')}`);
      }

      for (const item of isolated) {
        try {
          fs.unlinkSync(item.isolatePath);
          purged.push({
            id: item.id,
            generationId: item.generationId,
            sourceHash: item.sourceHash,
          });
          diagnostics.push(`SEED_MIGRATION_PURGED: ${item.id} (${item.generationId})`);
        } catch (error) {
          diagnostics.push(`SEED_MIGRATION_PURGE_FAILED: ${item.id}: ${error instanceof Error ? error.message : String(error)}`);
          this.restoreIsolated([item], diagnostics);
          retained.push({ id: item.id, reason: 'user-modified', sourceHash: item.sourceHash });
        }
      }
    } finally {
      this.removeDirIfEmpty(isolateRoot);
    }

    diagnostics.push(...this.removeLeftoverMigratedDir(agentsPath));

    const marker: SeedMigrationMarker = {
      schemaVersion: '1',
      completedAt: new Date().toISOString(),
      diagnostics,
      purged,
      retained,
    };
    this.io.writeJsonAtomic(markerPath, marker);
    return { marker, alreadyComplete: false };
  }

  private verifyAssetsIntact(
    agentsPath: string,
    userSnapshot: Map<string, { hash: string; id: string; candidateIds: string[]; official: { generationId: string } | null }>,
    isolated: Array<{ entry: string; isolatePath: string; id: string; sourceHash: string }>,
  ): string[] {
    const diagnostics: string[] = [];
    const builtinPath = this.lockOptions.builtinAgentsPath ?? defaultBuiltinAgentsPath();
    for (const id of BUILTIN_SEED_AGENT_IDS) {
      const builtinFile = path.join(builtinPath, `${id}.agent.md`);
      if (!fs.existsSync(builtinFile)) {
        diagnostics.push(`SEED_MIGRATION_BUILTIN_MISSING: ${builtinFile}`);
        continue;
      }
      try {
        const raw = fs.readFileSync(builtinFile, 'utf8');
        if (!raw.trim()) {
          diagnostics.push(`SEED_MIGRATION_BUILTIN_EMPTY: ${builtinFile}`);
        }
      } catch (error) {
        diagnostics.push(`SEED_MIGRATION_BUILTIN_UNREADABLE: ${builtinFile}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const isolatedEntries = new Set(isolated.map((item) => item.entry));
    for (const [entry, snapshot] of userSnapshot) {
      if (isolatedEntries.has(entry)) continue;
      const remainingPath = path.join(agentsPath, entry);
      if (!fs.existsSync(remainingPath)) {
        diagnostics.push(`SEED_MIGRATION_USER_ASSET_MISSING: ${remainingPath}`);
        continue;
      }
      const currentHash = this.hashFile(
        remainingPath,
        collectSeedMigrationCandidateIds(entry, fs.readFileSync(remainingPath, 'utf8'))[0] ?? idFromFileName(entry),
      );
      if (currentHash !== snapshot.hash) {
        diagnostics.push(`SEED_MIGRATION_USER_ASSET_CHANGED: ${remainingPath}`);
      }
    }

    for (const item of isolated) {
      if (!fs.existsSync(item.isolatePath)) {
        diagnostics.push(`SEED_MIGRATION_ISOLATE_MISSING: ${item.id}`);
        continue;
      }
      const isolatedHash = this.hashFile(item.isolatePath, item.id);
      if (isolatedHash !== item.sourceHash) {
        diagnostics.push(`SEED_MIGRATION_ISOLATE_MISMATCH: ${item.id}`);
      }
    }
    return diagnostics;
  }

  private restoreIsolated(
    isolated: Array<{ sourcePath: string; isolatePath: string; id: string }>,
    diagnostics: string[],
  ): void {
    for (const item of isolated) {
      if (!fs.existsSync(item.isolatePath)) continue;
      if (fs.existsSync(item.sourcePath)) continue;
      try {
        fs.renameSync(item.isolatePath, item.sourcePath);
      } catch (error) {
        diagnostics.push(`SEED_MIGRATION_RESTORE_FAILED: ${item.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private removeLeftoverMigratedDir(agentsPath: string): string[] {
    const migratedRoot = path.join(agentsPath, SEED_MIGRATED_DIR_NAME);
    if (!fs.existsSync(migratedRoot)) return [];
    try {
      fs.rmSync(migratedRoot, { recursive: true, force: true });
      return [`SEED_MIGRATION_LEFTOVER_MIGRATED_REMOVED: ${migratedRoot}`];
    } catch (error) {
      return [`SEED_MIGRATION_LEFTOVER_MIGRATED_REMOVE_FAILED: ${error instanceof Error ? error.message : String(error)}`];
    }
  }

  private removeDirIfEmpty(dirPath: string): void {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
    } catch {
      // best-effort temp cleanup
    }
  }

  private hashFile(filePath: string, id: string): string {
    return hashSeedSemanticManifest(extractSeedSemanticManifest(fs.readFileSync(filePath, 'utf8'), id));
  }

  private rereadSourceHash(sourcePath: string, id: string): { raw: string; hash: string } | null {
    try {
      const raw = fs.readFileSync(sourcePath, 'utf8');
      return { raw, hash: hashSeedSemanticManifest(extractSeedSemanticManifest(raw, id)) };
    } catch {
      return null;
    }
  }

  private readMarker(markerPath: string): SeedMigrationMarker | null {
    if (!fs.existsSync(markerPath)) return null;
    const raw = this.io.readJson<unknown>(markerPath);
    if (raw == null) return null;
    const parsed = parseStoredDocument(raw, SEED_MIGRATION_MARKER_MIGRATIONS, markerPath);
    if ((!parsed.purged || parsed.purged.length === 0) && parsed.moved?.length) {
      parsed.purged = parsed.moved.map(({ id, generationId, sourceHash }) => ({ id, generationId, sourceHash }));
    }
    return parsed;
  }
}

export const agentSeedMigrationService = new AgentSeedMigrationService();
