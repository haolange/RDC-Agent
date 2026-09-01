import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { StorageIo } from '../../sessions/StorageIo';
import { withDirectoryFileLockSync } from '../../sessions/directoryFileLock';
import { parseStoredDocument, type StorageMigration } from '../../sessions/storageSchema';
import { extractSeedSemanticManifest, hashSeedSemanticManifest, readSeedFrontmatterId } from './semanticHash';
import { expandOfficialS0IdAliases, officialSeedHashIndex } from './officialSeedGenerations';

export const SEED_MIGRATION_MARKER_NAME = '.seed-migration.json';
export const SEED_MIGRATED_DIR_NAME = '.migrated';

const SeedMigrationMarkerV1Schema = z.object({
  schemaVersion: z.literal('1'),
  completedAt: z.string(),
  diagnostics: z.array(z.string()),
  moved: z.array(z.object({
    id: z.string(),
    generationId: z.string(),
    sourceHash: z.string(),
    archivedPath: z.string(),
  })),
  retained: z.array(z.object({
    id: z.string(),
    reason: z.enum(['user-modified', 'unknown-custom', 'target-hash-conflict']),
    sourceHash: z.string(),
  })),
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

export class AgentSeedMigrationService {
  constructor(
    private readonly io = new StorageIo(),
    private readonly lockOptions: { maxAttempts?: number } = {},
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
      return { marker: existing, alreadyComplete: true };
    }

    const index = officialSeedHashIndex();
    const diagnostics: string[] = [];
    const moved: SeedMigrationMarker['moved'] = [];
    const retained: SeedMigrationMarker['retained'] = [];
    const entries = fs.existsSync(agentsPath)
      ? fs.readdirSync(agentsPath).filter((entry) => entry.endsWith('.agent.md'))
      : [];

    for (const entry of entries) {
      const sourcePath = path.join(agentsPath, entry);
      let raw: string;
      try {
        raw = fs.readFileSync(sourcePath, 'utf8');
      } catch (error) {
        diagnostics.push(`SEED_MIGRATION_READ_FAILED: ${sourcePath}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      const candidates = collectSeedMigrationCandidateIds(entry, raw);
      const fallbackId = candidates[0] ?? idFromFileName(entry);
      let matched: { id: string; sourceHash: string; official: { generationId: string } } | null = null;
      let unmatchedSemantic = extractSeedSemanticManifest(raw, fallbackId);
      for (const candidateId of candidates) {
        const semantic = extractSeedSemanticManifest(raw, candidateId);
        const sourceHash = hashSeedSemanticManifest(semantic);
        const official = index.get(sourceHash);
        if (official) {
          matched = { id: candidateId, sourceHash, official };
          break;
        }
        unmatchedSemantic = semantic;
      }
      if (!matched) {
        retained.push({
          id: fallbackId,
          reason: unmatchedSemantic.models.length > 0 ? 'user-modified' : 'unknown-custom',
          sourceHash: hashSeedSemanticManifest(unmatchedSemantic),
        });
        continue;
      }

      const { id, sourceHash, official } = matched;
      const archiveDir = path.join(agentsPath, SEED_MIGRATED_DIR_NAME, official.generationId);
      const archivePath = path.join(archiveDir, entry);
      this.io.ensureDir(archiveDir);
      const reread = this.rereadSourceHash(sourcePath, id);
      if (!reread || reread.hash !== sourceHash) {
        retained.push({
          id,
          reason: 'user-modified',
          sourceHash: reread?.hash ?? sourceHash,
        });
        diagnostics.push(`SEED_MIGRATION_SOURCE_CHANGED: ${id} changed before move; left in place.`);
        continue;
      }

      if (fs.existsSync(archivePath)) {
        const archivedHash = hashSeedSemanticManifest(
          extractSeedSemanticManifest(fs.readFileSync(archivePath, 'utf8'), id),
        );
        if (archivedHash === reread.hash) {
          fs.unlinkSync(sourcePath);
          moved.push({
            id,
            generationId: official.generationId,
            sourceHash: reread.hash,
            archivedPath: archivePath,
          });
          diagnostics.push(`SEED_MIGRATION_IDEMPOTENT: ${id} already archived under ${official.generationId}`);
          continue;
        }
        retained.push({ id, reason: 'target-hash-conflict', sourceHash: reread.hash });
        diagnostics.push(
          `SEED_MIGRATION_TARGET_CONFLICT: ${id} matches official ${official.generationId} but ${archivePath} has a different hash; left in place.`,
        );
        continue;
      }

      try {
        fs.renameSync(sourcePath, archivePath);
      } catch (error) {
        diagnostics.push(`SEED_MIGRATION_MOVE_FAILED: ${id}: ${error instanceof Error ? error.message : String(error)}`);
        retained.push({ id, reason: 'user-modified', sourceHash: reread.hash });
        continue;
      }
      const archivedHash = hashSeedSemanticManifest(
        extractSeedSemanticManifest(fs.readFileSync(archivePath, 'utf8'), id),
      );
      if (archivedHash !== reread.hash) {
        diagnostics.push(`SEED_MIGRATION_ARCHIVE_MISMATCH: ${id} archive hash diverged after rename.`);
      }
      moved.push({
        id,
        generationId: official.generationId,
        sourceHash: reread.hash,
        archivedPath: archivePath,
      });
    }

    const marker: SeedMigrationMarker = {
      schemaVersion: '1',
      completedAt: new Date().toISOString(),
      diagnostics,
      moved,
      retained,
    };
    this.io.writeJsonAtomic(markerPath, marker);
    return { marker, alreadyComplete: false };
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
    return parseStoredDocument(raw, SEED_MIGRATION_MARKER_MIGRATIONS, markerPath);
  }
}

export const agentSeedMigrationService = new AgentSeedMigrationService();
