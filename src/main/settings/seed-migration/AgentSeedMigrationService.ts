import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { StorageIo } from '../../sessions/StorageIo';
import { withDirectoryFileLockSync } from '../../sessions/directoryFileLock';
import { parseStoredDocument, StorageSchemaError, type StorageMigration } from '../../sessions/storageSchema';
import {
  extractSeedSemanticManifest,
  hashCanonicalAgentSemantics,
  hashSeedSemanticManifest,
  readSeedFrontmatterId,
} from './semanticHash';
import {
  HISTORICAL_RESERVED_AGENT_IDS,
  officialSeedHashIndex,
} from './officialSeedGenerations';

export const SEED_MIGRATION_MARKER_NAME = '.seed-migration.json';
export const SEED_MIGRATED_DIR_NAME = '.migrated';
export const SEED_PURGE_ISOLATION_MANIFEST_NAME = '.seed-purge-isolation.json';
export const SEED_PURGE_ISOLATION_DIR_NAME = '.seed-purge-isolation';
export const SEED_MIGRATION_RULE_VERSION = 'canonical-v2';
export const BUILTIN_SEED_AGENT_IDS = ['general', 'debugger', 'analyzer', 'optimizer'] as const;

const SeedMigrationActionSchema = z.enum([
  'purged-historical',
  'purged-shadow',
  'retained-override',
  'retained-custom',
  'invalid-id',
]);

const SeedMigrationActionRecordSchema = z.object({
  file: z.string(),
  frontmatterId: z.string().nullable(),
  filenameId: z.string(),
  action: SeedMigrationActionSchema,
  hashBefore: z.string(),
  canonicalHash: z.string().optional(),
  reason: z.string(),
}).strict();

const SeedMigrationMarkerV2Schema = z.object({
  schemaVersion: z.literal('2'),
  ruleVersion: z.string(),
  directoryContentHash: z.string(),
  completedAt: z.string(),
  diagnostics: z.array(z.string()),
  actions: z.array(SeedMigrationActionRecordSchema),
}).strict();

export type SeedMigrationAction = z.infer<typeof SeedMigrationActionSchema>;
export type SeedMigrationActionRecord = z.infer<typeof SeedMigrationActionRecordSchema>;
export type SeedMigrationMarker = z.infer<typeof SeedMigrationMarkerV2Schema>;

export const SEED_MIGRATION_MARKER_MIGRATIONS: StorageMigration<SeedMigrationMarker>[] = [
  { schemaVersion: '2', schema: SeedMigrationMarkerV2Schema },
];

const SeedPurgeIsolationFileSchema = z.object({
  file: z.string(),
  hashBefore: z.string(),
  isolateName: z.string(),
}).strict();

const SeedPurgeIsolationManifestSchema = z.object({
  schemaVersion: z.literal('1'),
  isolationDir: z.string(),
  files: z.array(SeedPurgeIsolationFileSchema),
}).strict();

export type SeedPurgeIsolationManifest = z.infer<typeof SeedPurgeIsolationManifestSchema>;

export const SEED_PURGE_ISOLATION_MIGRATIONS: StorageMigration<SeedPurgeIsolationManifest>[] = [
  { schemaVersion: '1', schema: SeedPurgeIsolationManifestSchema },
];

const PROTECTED_ACTIONS = new Set<SeedMigrationAction>([
  'retained-override',
  'retained-custom',
  'invalid-id',
]);

const idFromFileName = (fileName: string): string => fileName.replace(/\.agent\.md$/u, '');

const hashRawContent = (content: string): string =>
  createHash('sha256').update(content, 'utf8').digest('hex');

export function computeAgentsDirectoryContentHash(agentsPath: string): string {
  const entries = listAgentFiles(agentsPath).sort((left, right) => left.localeCompare(right));
  const payload = entries.map((fileName) => ({
    file: fileName,
    hash: hashRawContent(fs.readFileSync(path.join(agentsPath, fileName), 'utf8')),
  }));
  return createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex');
}

function listAgentFiles(agentsPath: string): string[] {
  if (!fs.existsSync(agentsPath)) return [];
  return fs.readdirSync(agentsPath).filter((entry) => entry.endsWith('.agent.md') && !entry.startsWith('.'));
}

function peekSchemaVersion(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const version = (raw as { schemaVersion?: unknown }).schemaVersion;
  return typeof version === 'string' ? version : typeof version === 'number' ? String(version) : null;
}

export interface SeedMigrationResult {
  marker: SeedMigrationMarker | null;
  alreadyComplete: boolean;
  diagnostics: string[];
}

export interface AgentSeedMigrationOptions {
  maxAttempts?: number;
  builtinAgentsPath?: string;
}

function defaultBuiltinAgentsPath(): string {
  return path.resolve(process.cwd(), 'resources', 'agent-runtime', 'agents');
}

interface ClassifiedSeed {
  file: string;
  sourcePath: string;
  filenameId: string;
  frontmatterId: string | null;
  raw: string;
  hashBefore: string;
  action: SeedMigrationAction;
  canonicalHash?: string;
  reason: string;
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

  /**
   * Persist an explicit user copy-on-write and its migration ownership under
   * the same directory lock. Historical shadow detection remains unchanged;
   * only writes through the public settings API receive this protected action.
   */
  writeExplicitUserOverride(agentsPath: string, fileName: string, content: string): void {
    this.io.ensureDir(agentsPath);
    withDirectoryFileLockSync(
      agentsPath,
      {
        lockFileName: '.seed-migration.lock',
        timeoutCode: 'SEED_MIGRATION_LOCK_TIMEOUT',
        maxAttempts: this.lockOptions.maxAttempts,
      },
      () => {
        const markerPath = path.join(agentsPath, SEED_MIGRATION_MARKER_NAME);
        let marker = this.peekMarker(markerPath).marker;
        if (!marker) marker = this.migrateUserAgentsLocked(agentsPath).marker;
        if (!marker) throw new Error('SEED_MIGRATION_MARKER_REQUIRED: explicit user override could not be recorded.');

        const filePath = path.join(agentsPath, fileName);
        const previous = fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
        const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
        try {
          fs.writeFileSync(temporaryPath, content, 'utf8');
          fs.renameSync(temporaryPath, filePath);
        } finally {
          try { fs.rmSync(temporaryPath, { force: true }); } catch { /* best effort */ }
        }

        const filenameId = idFromFileName(fileName);
        const semantic = extractSeedSemanticManifest(content, filenameId);
        const action: SeedMigrationActionRecord = {
          file: fileName,
          frontmatterId: readSeedFrontmatterId(content),
          filenameId,
          action: (BUILTIN_SEED_AGENT_IDS as readonly string[]).includes(filenameId)
            ? 'retained-override'
            : 'retained-custom',
          hashBefore: hashRawContent(content),
          canonicalHash: hashCanonicalAgentSemantics(semantic),
          reason: 'explicit user save through AgentManifestService',
        };
        const actions = marker.actions.filter((entry) => entry.file !== fileName);
        actions.push(action);
        try {
          this.writeCompletedMarker(markerPath, agentsPath, actions, marker.diagnostics);
        } catch (error) {
          this.restoreExplicitOverride(filePath, previous);
          throw error;
        }
      },
    );
  }

  private restoreExplicitOverride(filePath: string, previous: Buffer | null): void {
    if (previous === null) {
      fs.rmSync(filePath, { force: true });
      return;
    }
    const restorePath = `${filePath}.${process.pid}.${Date.now()}.restore`;
    try {
      fs.writeFileSync(restorePath, previous);
      fs.renameSync(restorePath, filePath);
    } finally {
      try { fs.rmSync(restorePath, { force: true }); } catch { /* best effort */ }
    }
  }

  private migrateUserAgentsLocked(agentsPath: string): SeedMigrationResult {
    const markerPath = path.join(agentsPath, SEED_MIGRATION_MARKER_NAME);
    const peeked = this.peekMarker(markerPath);
    if (peeked.unsupported) {
      return {
        marker: null,
        alreadyComplete: true,
        diagnostics: [peeked.diagnostic ?? `SEED_MIGRATION_SCHEMA_UNSUPPORTED: ${markerPath}`],
      };
    }

    const isolationRecovery = this.recoverIsolation(agentsPath);
    if (isolationRecovery.blocked) {
      return {
        marker: null,
        alreadyComplete: false,
        diagnostics: isolationRecovery.diagnostics,
      };
    }

    if (peeked.marker && peeked.marker.directoryContentHash === computeAgentsDirectoryContentHash(agentsPath)) {
      return {
        marker: peeked.marker,
        alreadyComplete: true,
        diagnostics: isolationRecovery.diagnostics,
      };
    }

    const leftoverDiagnostics = this.removeLeftoverMigratedDir(agentsPath);

    const protectedFiles = new Map<string, SeedMigrationActionRecord>();
    if (peeked.marker) {
      for (const action of peeked.marker.actions) {
        if (PROTECTED_ACTIONS.has(action.action)) {
          protectedFiles.set(action.file, action);
        }
      }
    }

    const diagnostics = [...isolationRecovery.diagnostics, ...leftoverDiagnostics];
    const actions: SeedMigrationActionRecord[] = [];
    const toPurge: ClassifiedSeed[] = [];
    const remainingSnapshot = new Map<string, string>();
    const officialIndex = officialSeedHashIndex();
    const builtinCanonical = this.readBuiltinCanonicalHashes(diagnostics);

    for (const file of listAgentFiles(agentsPath)) {
      const sourcePath = path.join(agentsPath, file);
      let raw: string;
      try {
        raw = fs.readFileSync(sourcePath, 'utf8');
      } catch (error) {
        diagnostics.push(`SEED_MIGRATION_READ_FAILED: ${sourcePath}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      const hashBefore = hashRawContent(raw);
      remainingSnapshot.set(file, hashBefore);
      const previous = protectedFiles.get(file);
      if (previous) {
        actions.push(previous);
        continue;
      }

      const classified = this.classifySeed(file, sourcePath, raw, hashBefore, builtinCanonical, officialIndex, diagnostics);
      if (!classified) continue;
      if (classified.action === 'purged-historical' || classified.action === 'purged-shadow') {
        toPurge.push(classified);
      } else {
        actions.push(this.toActionRecord(classified));
      }
    }

    if (toPurge.length === 0) {
      const marker = this.writeCompletedMarker(markerPath, agentsPath, actions, diagnostics);
      return { marker, alreadyComplete: false, diagnostics: marker.diagnostics };
    }

    const isolation = this.beginIsolation(agentsPath, toPurge, diagnostics);
    actions.push(...isolation.retained.map((item) => this.toActionRecord(item)));

    try {
      const verifyDiagnostics = this.verifyAssetsIntact(
        agentsPath,
        remainingSnapshot,
        isolation.isolated,
      );
      if (verifyDiagnostics.length > 0) {
        this.restoreIsolated(isolation.isolated, diagnostics);
        this.clearIsolationArtifacts(agentsPath);
        diagnostics.push(...verifyDiagnostics);
        throw new Error(`SEED_MIGRATION_VERIFY_FAILED: ${verifyDiagnostics.join(' | ')}`);
      }

      for (const item of isolation.isolated) {
        try {
          fs.unlinkSync(item.isolatePath);
          actions.push(this.toActionRecord(item.classified));
          diagnostics.push(`SEED_MIGRATION_PURGED: ${item.classified.filenameId} (${item.classified.action})`);
        } catch (error) {
          diagnostics.push(`SEED_MIGRATION_PURGE_FAILED: ${item.classified.filenameId}: ${error instanceof Error ? error.message : String(error)}`);
          this.restoreIsolated([item], diagnostics);
          actions.push({
            file: item.classified.file,
            frontmatterId: item.classified.frontmatterId,
            filenameId: item.classified.filenameId,
            action: item.classified.filenameId && HISTORICAL_RESERVED_AGENT_IDS.has(item.classified.filenameId)
              ? 'retained-custom'
              : 'retained-override',
            hashBefore: item.classified.hashBefore,
            canonicalHash: item.classified.canonicalHash,
            reason: 'purge-failed-restored',
          });
        }
      }
    } finally {
      this.clearIsolationArtifacts(agentsPath);
    }

    const marker = this.writeCompletedMarker(markerPath, agentsPath, actions, diagnostics);
    return { marker, alreadyComplete: false, diagnostics: marker.diagnostics };
  }

  private classifySeed(
    file: string,
    sourcePath: string,
    raw: string,
    hashBefore: string,
    builtinCanonical: Map<string, string>,
    officialIndex: ReturnType<typeof officialSeedHashIndex>,
    diagnostics: string[],
  ): ClassifiedSeed | null {
    const filenameId = idFromFileName(file);
    const frontmatterId = readSeedFrontmatterId(raw);
    if (frontmatterId && frontmatterId !== filenameId) {
      const reason = `filename/frontmatter id mismatch: ${filenameId} vs ${frontmatterId}`;
      diagnostics.push(`SEED_MIGRATION_INVALID_ID: ${file}: ${reason}`);
      return {
        file,
        sourcePath,
        filenameId,
        frontmatterId,
        raw,
        hashBefore,
        action: 'invalid-id',
        reason,
      };
    }

    const id = filenameId;
    const manifest = extractSeedSemanticManifest(raw, id);
    const canonicalHash = hashCanonicalAgentSemantics(manifest);
    const official = officialIndex.get(hashSeedSemanticManifest(manifest));

    if (HISTORICAL_RESERVED_AGENT_IDS.has(id)) {
      return {
        file,
        sourcePath,
        filenameId,
        frontmatterId,
        raw,
        hashBefore,
        action: 'purged-historical',
        canonicalHash,
        reason: official
          ? `historical reserved id (${official.generationId})`
          : 'historical reserved id',
      };
    }

    if ((BUILTIN_SEED_AGENT_IDS as readonly string[]).includes(id)) {
      const builtinHash = builtinCanonical.get(id);
      if (builtinHash && builtinHash === canonicalHash) {
        return {
          file,
          sourcePath,
          filenameId,
          frontmatterId,
          raw,
          hashBefore,
          action: 'purged-shadow',
          canonicalHash,
          reason: 'canonical hash matches current builtin',
        };
      }
      return {
        file,
        sourcePath,
        filenameId,
        frontmatterId,
        raw,
        hashBefore,
        action: 'retained-override',
        canonicalHash,
        reason: 'builtin id differs from current builtin canonical hash',
      };
    }

    return {
      file,
      sourcePath,
      filenameId,
      frontmatterId,
      raw,
      hashBefore,
      action: 'retained-custom',
      canonicalHash,
      reason: 'unrelated custom id',
    };
  }

  private toActionRecord(classified: ClassifiedSeed): SeedMigrationActionRecord {
    return {
      file: classified.file,
      frontmatterId: classified.frontmatterId,
      filenameId: classified.filenameId,
      action: classified.action,
      hashBefore: classified.hashBefore,
      ...(classified.canonicalHash ? { canonicalHash: classified.canonicalHash } : {}),
      reason: classified.reason,
    };
  }

  private beginIsolation(
    agentsPath: string,
    toPurge: ClassifiedSeed[],
    diagnostics: string[],
  ): {
    isolated: Array<{
      classified: ClassifiedSeed;
      sourcePath: string;
      isolatePath: string;
    }>;
    retained: ClassifiedSeed[];
  } {
    const isolationDir = path.join(agentsPath, SEED_PURGE_ISOLATION_DIR_NAME);
    const manifestPath = path.join(agentsPath, SEED_PURGE_ISOLATION_MANIFEST_NAME);
    this.io.ensureDir(isolationDir);
    const files = toPurge.map((item) => ({
      file: item.file,
      hashBefore: item.hashBefore,
      isolateName: item.file,
    }));
    const manifest: SeedPurgeIsolationManifest = {
      schemaVersion: '1',
      isolationDir: SEED_PURGE_ISOLATION_DIR_NAME,
      files,
    };
    this.io.writeJsonAtomic(manifestPath, manifest);

    const isolated: Array<{
      classified: ClassifiedSeed;
      sourcePath: string;
      isolatePath: string;
    }> = [];
    const retained: ClassifiedSeed[] = [];
    for (const item of toPurge) {
      const isolatePath = path.join(isolationDir, item.file);
      const current = this.readRawHash(item.sourcePath);
      let classified = item;
      if (current && current.hash !== item.hashBefore) {
        const next = this.classifySeed(
          item.file,
          item.sourcePath,
          current.raw,
          current.hash,
          this.readBuiltinCanonicalHashes([]),
          officialSeedHashIndex(),
          diagnostics,
        );
        if (!next || (next.action !== 'purged-historical' && next.action !== 'purged-shadow')) {
          diagnostics.push(`SEED_MIGRATION_SOURCE_CHANGED: ${item.filenameId} changed before isolate; left in place.`);
          if (next) retained.push(next);
          continue;
        }
        classified = next;
      } else if (!current) {
        diagnostics.push(`SEED_MIGRATION_SOURCE_CHANGED: ${item.filenameId} disappeared before isolate.`);
        continue;
      }
      try {
        fs.renameSync(classified.sourcePath, isolatePath);
        isolated.push({ classified, sourcePath: classified.sourcePath, isolatePath });
      } catch (error) {
        diagnostics.push(`SEED_MIGRATION_ISOLATE_FAILED: ${classified.filenameId}: ${error instanceof Error ? error.message : String(error)}`);
        retained.push({
          ...classified,
          action: classified.action === 'purged-historical' ? 'retained-custom' : 'retained-override',
          reason: 'isolate-failed',
        });
      }
    }
    return { isolated, retained };
  }

  private recoverIsolation(agentsPath: string): { blocked: boolean; diagnostics: string[] } {
    const manifestPath = path.join(agentsPath, SEED_PURGE_ISOLATION_MANIFEST_NAME);
    const isolationDir = path.join(agentsPath, SEED_PURGE_ISOLATION_DIR_NAME);
    const manifestExists = fs.existsSync(manifestPath);
    const dirExists = fs.existsSync(isolationDir);
    if (!manifestExists && !dirExists) {
      return { blocked: false, diagnostics: [] };
    }

    const diagnostics: string[] = [];
    let manifest: SeedPurgeIsolationManifest | null = null;
    if (manifestExists) {
      try {
        const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown;
        const version = peekSchemaVersion(raw);
        if (version && Number(version) > 1) {
          diagnostics.push(`SEED_MIGRATION_ISOLATION_CORRUPT: ${manifestPath}: SEED_MIGRATION_SCHEMA_UNSUPPORTED`);
          this.restoreIsolationDirByFilename(agentsPath, isolationDir, diagnostics);
          return { blocked: true, diagnostics };
        }
        manifest = parseStoredDocument(raw, SEED_PURGE_ISOLATION_MIGRATIONS, manifestPath);
      } catch (error) {
        diagnostics.push(`SEED_MIGRATION_ISOLATION_CORRUPT: ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`);
        this.restoreIsolationDirByFilename(agentsPath, isolationDir, diagnostics);
        return { blocked: true, diagnostics };
      }
    } else {
      diagnostics.push(`SEED_MIGRATION_ISOLATION_CORRUPT: missing ${manifestPath}`);
      this.restoreIsolationDirByFilename(agentsPath, isolationDir, diagnostics);
      return { blocked: true, diagnostics };
    }

    const resolvedDir = path.join(agentsPath, manifest.isolationDir);
    for (const entry of manifest.files) {
      const isolatePath = path.join(resolvedDir, entry.isolateName);
      const sourcePath = path.join(agentsPath, entry.file);
      if (!fs.existsSync(isolatePath)) {
        if (!fs.existsSync(sourcePath)) {
          diagnostics.push(`SEED_MIGRATION_ISOLATION_MISSING: ${entry.file}`);
          return { blocked: true, diagnostics };
        }
        continue;
      }
      if (fs.existsSync(sourcePath)) {
        continue;
      }
      try {
        fs.renameSync(isolatePath, sourcePath);
        diagnostics.push(`SEED_MIGRATION_ISOLATION_RESTORED: ${entry.file}`);
      } catch (error) {
        diagnostics.push(`SEED_MIGRATION_RESTORE_FAILED: ${entry.file}: ${error instanceof Error ? error.message : String(error)}`);
        return { blocked: true, diagnostics };
      }
    }

    this.clearIsolationArtifacts(agentsPath);
    return { blocked: false, diagnostics };
  }

  private restoreIsolationDirByFilename(agentsPath: string, isolationDir: string, diagnostics: string[]): void {
    if (!fs.existsSync(isolationDir)) return;
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(isolationDir).filter((entry) => entry.endsWith('.agent.md'));
    } catch (error) {
      diagnostics.push(`SEED_MIGRATION_ISOLATION_CORRUPT: ${isolationDir}: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    for (const entry of entries) {
      const isolatePath = path.join(isolationDir, entry);
      const sourcePath = path.join(agentsPath, entry);
      if (fs.existsSync(sourcePath)) continue;
      try {
        fs.renameSync(isolatePath, sourcePath);
        diagnostics.push(`SEED_MIGRATION_ISOLATION_RESTORED: ${entry}`);
      } catch (error) {
        diagnostics.push(`SEED_MIGRATION_RESTORE_FAILED: ${entry}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private readBuiltinCanonicalHashes(diagnostics: string[]): Map<string, string> {
    const hashes = new Map<string, string>();
    const builtinPath = this.lockOptions.builtinAgentsPath ?? defaultBuiltinAgentsPath();
    for (const id of BUILTIN_SEED_AGENT_IDS) {
      const builtinFile = path.join(builtinPath, `${id}.agent.md`);
      try {
        const raw = fs.readFileSync(builtinFile, 'utf8');
        if (!raw.trim()) {
          diagnostics.push(`SEED_MIGRATION_BUILTIN_EMPTY: ${builtinFile}`);
          continue;
        }
        hashes.set(id, hashCanonicalAgentSemantics(extractSeedSemanticManifest(raw, id)));
      } catch (error) {
        diagnostics.push(`SEED_MIGRATION_BUILTIN_UNREADABLE: ${builtinFile}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return hashes;
  }

  private verifyAssetsIntact(
    agentsPath: string,
    remainingSnapshot: Map<string, string>,
    isolated: Array<{ classified: ClassifiedSeed; isolatePath: string }>,
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

    const isolatedFiles = new Set(isolated.map((item) => item.classified.file));
    for (const [file, hashBefore] of remainingSnapshot) {
      if (isolatedFiles.has(file)) continue;
      const remainingPath = path.join(agentsPath, file);
      if (!fs.existsSync(remainingPath)) {
        diagnostics.push(`SEED_MIGRATION_USER_ASSET_MISSING: ${remainingPath}`);
        continue;
      }
      if (hashRawContent(fs.readFileSync(remainingPath, 'utf8')) !== hashBefore) {
        diagnostics.push(`SEED_MIGRATION_USER_ASSET_CHANGED: ${remainingPath}`);
      }
    }

    for (const item of isolated) {
      if (!fs.existsSync(item.isolatePath)) {
        diagnostics.push(`SEED_MIGRATION_ISOLATE_MISSING: ${item.classified.filenameId}`);
        continue;
      }
      if (hashRawContent(fs.readFileSync(item.isolatePath, 'utf8')) !== item.classified.hashBefore) {
        diagnostics.push(`SEED_MIGRATION_ISOLATE_MISMATCH: ${item.classified.filenameId}`);
      }
    }
    return diagnostics;
  }

  private restoreIsolated(
    isolated: Array<{ sourcePath: string; isolatePath: string; classified: ClassifiedSeed }>,
    diagnostics: string[],
  ): void {
    for (const item of isolated) {
      if (!fs.existsSync(item.isolatePath)) continue;
      if (fs.existsSync(item.sourcePath)) continue;
      try {
        fs.renameSync(item.isolatePath, item.sourcePath);
      } catch (error) {
        diagnostics.push(`SEED_MIGRATION_RESTORE_FAILED: ${item.classified.filenameId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private clearIsolationArtifacts(agentsPath: string): void {
    const manifestPath = path.join(agentsPath, SEED_PURGE_ISOLATION_MANIFEST_NAME);
    const isolationDir = path.join(agentsPath, SEED_PURGE_ISOLATION_DIR_NAME);
    try {
      if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath);
    } catch {
      // best-effort
    }
    try {
      if (fs.existsSync(isolationDir)) fs.rmSync(isolationDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }

  private writeCompletedMarker(
    markerPath: string,
    agentsPath: string,
    actions: SeedMigrationActionRecord[],
    diagnostics: string[],
  ): SeedMigrationMarker {
    const marker: SeedMigrationMarker = {
      schemaVersion: '2',
      ruleVersion: SEED_MIGRATION_RULE_VERSION,
      directoryContentHash: computeAgentsDirectoryContentHash(agentsPath),
      completedAt: new Date().toISOString(),
      diagnostics,
      actions,
    };
    this.io.writeJsonAtomic(markerPath, marker);
    return marker;
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

  private readRawHash(filePath: string): { raw: string; hash: string } | null {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      return { raw, hash: hashRawContent(raw) };
    } catch {
      return null;
    }
  }

  private peekMarker(markerPath: string): {
    marker: SeedMigrationMarker | null;
    unsupported: boolean;
    diagnostic?: string;
  } {
    if (!fs.existsSync(markerPath)) {
      return { marker: null, unsupported: false };
    }
    let raw: unknown;
    try {
      raw = this.io.readJson<unknown>(markerPath);
    } catch (error) {
      if (error instanceof StorageSchemaError && error.message.includes('STORAGE_SCHEMA_UNSUPPORTED')) {
        return {
          marker: null,
          unsupported: true,
          diagnostic: `SEED_MIGRATION_SCHEMA_UNSUPPORTED: ${markerPath}: ${error.message}`,
        };
      }
      throw error;
    }
    if (raw == null) return { marker: null, unsupported: false };
    const version = peekSchemaVersion(raw);
    if (version == null || version === '1') {
      return { marker: null, unsupported: false };
    }
    const numeric = Number(version);
    if (Number.isFinite(numeric) && numeric >= 3) {
      return {
        marker: null,
        unsupported: true,
        diagnostic: `SEED_MIGRATION_SCHEMA_UNSUPPORTED: ${markerPath} has schemaVersion ${version}`,
      };
    }
    try {
      return {
        marker: parseStoredDocument(raw, SEED_MIGRATION_MARKER_MIGRATIONS, markerPath),
        unsupported: false,
      };
    } catch (error) {
      if (error instanceof StorageSchemaError && error.message.includes('STORAGE_SCHEMA_UNSUPPORTED')) {
        return {
          marker: null,
          unsupported: true,
          diagnostic: `SEED_MIGRATION_SCHEMA_UNSUPPORTED: ${markerPath}: ${error.message}`,
        };
      }
      throw error;
    }
  }
}

export const agentSeedMigrationService = new AgentSeedMigrationService();
