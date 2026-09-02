import fs from 'fs';
import path from 'path';
import { z } from 'zod';

export const CURRENT_HOOK_TRUST_SCHEMA_VERSION = '2' as const;

export interface HookTrustRecordV2 {
  trustFingerprint: string;
  trustedAt: string;
  scope: 'user' | 'project';
  hookId: string;
  ownerRoot: string;
}

export interface HookTrustStoreV2 {
  schemaVersion: typeof CURRENT_HOOK_TRUST_SCHEMA_VERSION;
  records: Record<string, HookTrustRecordV2>;
}

const HookTrustRecordV2Schema = z.object({
  trustFingerprint: z.string().min(1),
  trustedAt: z.string().min(1),
  scope: z.enum(['user', 'project']),
  hookId: z.string().min(1),
  ownerRoot: z.string().min(1),
}).strict();

const HookTrustStoreV2Schema = z.object({
  schemaVersion: z.literal(CURRENT_HOOK_TRUST_SCHEMA_VERSION),
  records: z.record(z.string(), HookTrustRecordV2Schema),
}).strict();

export const emptyHookTrustStore = (): HookTrustStoreV2 => ({
  schemaVersion: CURRENT_HOOK_TRUST_SCHEMA_VERSION,
  records: {},
});

export const hookTrustKey = (scope: 'user' | 'project', ownerRoot: string, hookId: string): string => (
  `${scope}::${path.resolve(ownerRoot).toLowerCase()}::${hookId}`
);

const looksLikeYamlOnlyV1 = (raw: unknown): boolean => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const record = raw as Record<string, unknown>;
  if ('schemaVersion' in record) {
    return record.schemaVersion === '1' || record.schemaVersion === 1;
  }
  return Object.values(record).every((entry) => (
    Boolean(entry)
    && typeof entry === 'object'
    && !Array.isArray(entry)
    && typeof (entry as { sourceHash?: unknown }).sourceHash === 'string'
    && !('trustFingerprint' in (entry as object))
  ));
};

const schemaVersionOf = (raw: unknown): string | undefined => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const version = (raw as { schemaVersion?: unknown }).schemaVersion;
  if (typeof version === 'string') return version;
  if (typeof version === 'number' && Number.isFinite(version)) return String(version);
  return undefined;
};

export const writeHookTrustStore = (trustStorePath: string, store: HookTrustStoreV2): void => {
  fs.mkdirSync(path.dirname(trustStorePath), { recursive: true });
  fs.writeFileSync(trustStorePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
};

export const readHookTrustStore = (trustStorePath: string): HookTrustStoreV2 => {
  if (!fs.existsSync(trustStorePath)) return emptyHookTrustStore();
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(trustStorePath, 'utf8')) as unknown;
  } catch {
    return emptyHookTrustStore();
  }
  const version = schemaVersionOf(raw);
  if (version !== undefined) {
    const numeric = Number(version);
    if (Number.isFinite(numeric) && numeric > Number(CURRENT_HOOK_TRUST_SCHEMA_VERSION)) {
      throw new Error(
        `STORAGE_SCHEMA_UNSUPPORTED: ${trustStorePath} has schemaVersion ${version}; supported up to ${CURRENT_HOOK_TRUST_SCHEMA_VERSION}`,
      );
    }
  }
  if (version === CURRENT_HOOK_TRUST_SCHEMA_VERSION) {
    const parsed = HookTrustStoreV2Schema.safeParse(raw);
    if (!parsed.success) {
      return emptyHookTrustStore();
    }
    return parsed.data;
  }
  if (looksLikeYamlOnlyV1(raw) || version === '1' || version === undefined && raw && typeof raw === 'object') {
    const invalidated = emptyHookTrustStore();
    writeHookTrustStore(trustStorePath, invalidated);
    return invalidated;
  }
  return emptyHookTrustStore();
};
