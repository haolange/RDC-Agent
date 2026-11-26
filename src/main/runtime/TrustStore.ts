import { z } from 'zod';
import { errorCodeOf } from '@shared/errors/appError';
import { parseJsonWith, readValidatedSync, writeFileAtomicSync } from './atomicFile';

/**
 * The one store behind every trust decision (hooks, project MCP servers, project Agent profiles). A record binds one
 * resource in one real owner directory (a project root, or the user resource root) to the fingerprint the user
 * trusted; any other fingerprint is untrusted.
 *
 * - Writes are atomic.
 * - A damaged file is `STORAGE_CORRUPT` on every read, never an empty store; trusting again rewrites it (the damaged
 *   bytes stay kept beside it), so the user can recover by repeating the decision.
 * - The file carries no format version: one written in another format fails the strict schema like a damaged file.
 */
export type TrustScope = 'user' | 'project';

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
    return (
      readValidatedSync(
        this.filePath(),
        parseJsonWith((document) => TrustFileSchema.parse(document).records),
      ) ?? {}
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
    writeFileAtomicSync(this.filePath(), `${JSON.stringify({ records }, null, 2)}\n`);
  }
}
