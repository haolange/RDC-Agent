import { z } from 'zod';
import { AppError, errorCodeOf } from '@shared/errors/appError';
import { readValidatedSync, writeFileAtomicSync } from './atomicFile';

/**
 * The one store behind every trust decision (hooks, project MCP servers, project Agent profiles). A record binds one
 * resource in one real owner directory (a project root, or the user resource root) to the fingerprint the user
 * trusted; any other fingerprint is untrusted.
 *
 * - Writes are atomic.
 * - A damaged file is `STORAGE_CORRUPT` on every read, never an empty store; trusting again rewrites it (the damaged
 *   bytes stay kept beside it), so the user can recover by repeating the decision.
 * - A file written by another trust version holds no decision this version honors: nothing in it is trusted and
 *   the user is asked again. A newer version is `STORAGE_SCHEMA_UNSUPPORTED`.
 */
export type TrustScope = 'user' | 'project';

const TRUST_SCHEMA_VERSION = 3;

const TrustRecordSchema = z
  .object({
    scope: z.enum(['user', 'project']),
    ownerRealpath: z.string().min(1),
    resourceId: z.string().min(1),
    trustFingerprint: z.string().min(1),
    trustedAt: z.string().min(1),
  })
  .strict();

export type TrustRecord = z.infer<typeof TrustRecordSchema>;

const TrustFileSchema = z
  .object({
    schemaVersion: z.literal(TRUST_SCHEMA_VERSION),
    records: z.record(z.string(), TrustRecordSchema),
  })
  .strict();

type TrustRecords = Record<string, TrustRecord>;

const keyOf = (scope: TrustScope, ownerRealpath: string, resourceId: string): string =>
  `${scope}::${ownerRealpath.toLowerCase()}::${resourceId}`;

export class TrustStore {
  constructor(private readonly filePath: () => string) {}

  get(scope: TrustScope, ownerRealpath: string, resourceId: string): TrustRecord | undefined {
    return this.read()[keyOf(scope, ownerRealpath, resourceId)];
  }

  isTrusted(scope: TrustScope, ownerRealpath: string, resourceId: string, trustFingerprint: string): boolean {
    return this.get(scope, ownerRealpath, resourceId)?.trustFingerprint === trustFingerprint;
  }

  trust(scope: TrustScope, ownerRealpath: string, resourceId: string, trustFingerprint: string): TrustRecord {
    const records = this.readForUpdate();
    const record: TrustRecord = {
      scope,
      ownerRealpath,
      resourceId,
      trustFingerprint,
      trustedAt: new Date().toISOString(),
    };
    records[keyOf(scope, ownerRealpath, resourceId)] = record;
    this.write(records);
    return record;
  }

  /** Removes every record the predicate selects. */
  revoke(selects: (record: TrustRecord) => boolean): void {
    const records = this.readForUpdate();
    for (const [key, record] of Object.entries(records)) {
      if (selects(record)) delete records[key];
    }
    this.write(records);
  }

  private read(): TrustRecords {
    const path = this.filePath();
    return (
      readValidatedSync(path, (raw) => {
        const document = JSON.parse(raw) as unknown;
        const version =
          typeof document === 'object' && document !== null
            ? (document as { schemaVersion?: unknown }).schemaVersion
            : undefined;
        if (typeof version === 'number' && version > TRUST_SCHEMA_VERSION) {
          throw new AppError(
            'STORAGE_SCHEMA_UNSUPPORTED',
            `${path} has schemaVersion ${version}; supported up to ${TRUST_SCHEMA_VERSION}`,
          );
        }
        return version === TRUST_SCHEMA_VERSION ? TrustFileSchema.parse(document).records : {};
      }) ?? {}
    );
  }

  /** A trust decision the user repeats replaces a damaged file; reads keep reporting the damage until then. */
  private readForUpdate(): TrustRecords {
    try {
      return this.read();
    } catch (error) {
      if (errorCodeOf(error) === 'STORAGE_CORRUPT') return {};
      throw error;
    }
  }

  private write(records: TrustRecords): void {
    writeFileAtomicSync(
      this.filePath(),
      `${JSON.stringify({ schemaVersion: TRUST_SCHEMA_VERSION, records }, null, 2)}\n`,
    );
  }
}
