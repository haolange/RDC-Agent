import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { AppError } from '@shared/errors/appError';
import { appPathService } from '../runtime/AppPathService';

/**
 * The RDC-Tool operation catalog this build ships against: the skill guides were generated from it
 * (`scripts/generate-rdc-tool-guides.mjs` writes `resources/agent-runtime/rdc-tool-catalog-identity.json`).
 */
const CatalogIdentitySchema = z.object({
  schemaVersion: z.literal('1'),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
  toolCount: z.number().int().positive(),
}).strict();

export type RdcCatalogIdentity = z.infer<typeof CatalogIdentitySchema>;

let packaged: RdcCatalogIdentity | null = null;

export function packagedRdcCatalogIdentity(): RdcCatalogIdentity {
  packaged ??= CatalogIdentitySchema.parse(JSON.parse(fs.readFileSync(
    path.join(appPathService.getBuiltinAgentRuntimeRoot(), 'rdc-tool-catalog-identity.json'), 'utf8')));
  return packaged;
}

const VersionCatalogSchema = z.object({
  schema_version: z.string(),
  fingerprint: z.string(),
  tool_count: z.number().int(),
});

const short = (fingerprint: string) => fingerprint.slice(0, 12);

/**
 * The installation must report the catalog it serves (`version --json`), serve that same catalog (`tools list`), and
 * that catalog must be the one this build ships against. A mismatch names both sides so the person knows which
 * RDC-Tool to install.
 */
export function assertRdcCatalogIdentity(
  installed: { toolVersion: string; versionCatalog: unknown; served: { fingerprint: string; toolCount: number } },
  expected: RdcCatalogIdentity,
): void {
  const reported = VersionCatalogSchema.safeParse(installed.versionCatalog);
  if (!reported.success) {
    throw new AppError('RDC_UPGRADE_REQUIRED', `RDC-Tool ${installed.toolVersion} does not report its operation catalog.`);
  }
  if (reported.data.fingerprint !== installed.served.fingerprint || reported.data.tool_count !== installed.served.toolCount) {
    throw new AppError('RDC_CATALOG_MISMATCH', `RDC-Tool ${installed.toolVersion} reports catalog `
      + `${short(reported.data.fingerprint)} but serves ${short(installed.served.fingerprint)}.`);
  }
  if (installed.served.fingerprint !== expected.fingerprint || installed.served.toolCount !== expected.toolCount) {
    throw new AppError('RDC_CATALOG_MISMATCH', `RDC-Tool ${installed.toolVersion} serves catalog `
      + `${short(installed.served.fingerprint)} (${installed.served.toolCount} operations); this RDC-Agent needs `
      + `${short(expected.fingerprint)} (${expected.toolCount} operations).`);
  }
}
