import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import {
  KNOWLEDGE_CASE_CHAPTERS,
  type ColdDataIngestResult,
  type KnowledgeCardRecord,
  type KnowledgeCaseChapters,
  type KnowledgeScope,
} from '@shared/types/knowledge';

export type { ColdDataIngestResult, ColdDataIngestStatus } from '@shared/types/knowledge';

export const COLD_DATA_MAX_BYTES = 2 * 1024 * 1024;

const SECRET_RE = /\b(api[_-]?key|password|secret|credential|authorization|bearer\s+[a-z0-9._+\-/=]+)\b/i;
const DRIVE_ABS_RE = /(?<![A-Za-z0-9/])[A-Za-z]:[/\\]/;
const UNC_ABS_RE = /\\\\/;
const POSIX_ABS_RE = /(?:^|[\s"'`([{,:=])\/[A-Za-z0-9._-]+/;

export function containsAbsolutePath(text: string): boolean {
  return DRIVE_ABS_RE.test(text) || UNC_ABS_RE.test(text) || POSIX_ABS_RE.test(text);
}

function leakedSensitiveReason(...texts: Array<string | undefined>): 'secret-detected' | 'absolute-path' | null {
  for (const text of texts) {
    if (!text) continue;
    if (SECRET_RE.test(text)) return 'secret-detected';
    if (containsAbsolutePath(text)) return 'absolute-path';
  }
  return null;
}

export interface ColdDataPathStat {
  mtimeMs: number;
  size: number;
}

export interface ColdDataPathIo {
  stat(filePath: string): Promise<ColdDataPathStat>;
  readFile(filePath: string): Promise<Buffer>;
}

const defaultPathIo: ColdDataPathIo = {
  stat: async (filePath) => {
    const stat = await fs.stat(filePath);
    return { mtimeMs: stat.mtimeMs, size: stat.size };
  },
  readFile: (filePath) => fs.readFile(filePath),
};

export interface ColdDataAssetRef {
  file: string;
  role?: string;
  sha256?: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function collectStrings(value: unknown, into: string[] = []): string[] {
  if (typeof value === 'string') {
    into.push(value);
    return into;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectStrings(entry, into);
    return into;
  }
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) collectStrings(entry, into);
  }
  return into;
}

function mapScope(environment: Record<string, unknown>): KnowledgeScope {
  return {
    ...(readString(environment.platform) ? { platform: readString(environment.platform) } : {}),
    ...(readString(environment.api) ? { api: readString(environment.api) } : {}),
    ...(readString(environment.gpu_vendor) || readString(environment.gpuVendor)
      ? { gpuVendor: readString(environment.gpu_vendor) || readString(environment.gpuVendor) }
      : {}),
    ...(readString(environment.gpu_arch) || readString(environment.gpuArch)
      ? { gpuArch: readString(environment.gpu_arch) || readString(environment.gpuArch) }
      : {}),
    ...(readString(environment.engine) ? { engine: readString(environment.engine) } : {}),
    ...(readString(environment.engine_version) || readString(environment.engineVersion)
      ? { engineVersion: readString(environment.engine_version) || readString(environment.engineVersion) }
      : {}),
    ...(readString(environment.device) ? { device: readString(environment.device) } : {}),
    ...(readString(environment.driver) ? { driver: readString(environment.driver) } : {}),
    ...(readString(environment.renderer_path) ? { featureConfiguration: readString(environment.renderer_path) } : {}),
  };
}

const FILENAME_TOKEN_RE = /(?:[A-Za-z0-9._\u4e00-\u9fff()-]|（|）)+?\.(?:png|jpe?g|gif|webp|bmp|txt|md|ya?ml|json|hlsl|ush|spv|spirv|bin|rdc|log|diff|csv)\b/gi;

function opaqueAssetId(file: string): string {
  return `asset-${createHash('sha256').update(file, 'utf8').digest('hex').slice(0, 8)}`;
}

function replaceMappedNames(text: string, mapping: Map<string, string>): string {
  let next = text;
  for (const name of [...mapping.keys()].sort((left, right) => right.length - left.length)) {
    const id = mapping.get(name);
    if (!id) continue;
    next = next.split(name).join(id);
  }
  return next;
}

function stripLeftoverFilenames(text: string): string {
  FILENAME_TOKEN_RE.lastIndex = 0;
  return text.replace(FILENAME_TOKEN_RE, '').replace(/[ \t]{2,}/g, ' ');
}

const PROVENANCE_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

/** Keep short provenance tokens (`fixed`, case ids). Drop filename-shaped values. */
export function sanitizeProvenanceToken(value: string | undefined): string | undefined {
  if (!value) return undefined;
  FILENAME_TOKEN_RE.lastIndex = 0;
  if (FILENAME_TOKEN_RE.test(value) || /[/\\]/.test(value) || /\s/.test(value)) return undefined;
  return PROVENANCE_TOKEN_RE.test(value) ? value : undefined;
}

function redactText(text: string, mapping: Map<string, string>): string {
  return stripLeftoverFilenames(replaceMappedNames(text, mapping));
}

function redactValue(value: unknown, mapping: Map<string, string>): unknown {
  if (typeof value === 'string') return redactText(value, mapping);
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, mapping));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if ((key === 'file' || key === 'asset') && typeof nested === 'string') {
        out[key] = mapping.get(nested) ?? redactText(nested, mapping);
        continue;
      }
      out[key] = redactValue(nested, mapping);
    }
    return out;
  }
  return value;
}

function collectAssets(raw: unknown): ColdDataAssetRef[] {
  const assets: ColdDataAssetRef[] = [];
  const visit = (value: unknown) => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    if (typeof value === 'object') {
      const row = value as Record<string, unknown>;
      if (typeof row.file === 'string') {
        assets.push({
          file: row.file,
          ...(typeof row.role === 'string' ? { role: row.role } : {}),
          ...(typeof row.sha256 === 'string' ? { sha256: row.sha256 } : {}),
        });
        return;
      }
      for (const nested of Object.values(row)) visit(nested);
    }
  };
  visit(raw);
  return assets;
}

function chapterFrom(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object') return JSON.stringify(value);
  return undefined;
}

function buildChapters(doc: Record<string, unknown>, scope: KnowledgeScope): KnowledgeCaseChapters {
  const rootCause = asRecord(doc.root_cause);
  const fix = asRecord(doc.fix);
  const generalization = asRecord(doc.generalization);
  const notes = asRecord(doc.notes);
  return {
    claim: readString(doc.title),
    scopeExclusions: Object.keys(scope).length > 0 ? JSON.stringify(scope) : undefined,
    symptoms: chapterFrom(doc.symptoms) || chapterFrom(asRecord(doc.repro)),
    evidence: chapterFrom(doc.evidence),
    rootCause: Object.keys(rootCause).length > 0 ? JSON.stringify(rootCause) : undefined,
    experimentVerification: chapterFrom(doc.verification_plan),
    fix: chapterFrom(fix.summary) || chapterFrom(doc.fix),
    negative: chapterFrom(generalization.do_not_retry) || chapterFrom(notes.negative),
    openChallenges: chapterFrom(doc.open_challenges) || chapterFrom(notes.open),
    derived: chapterFrom(notes.derived_feature) || chapterFrom(generalization),
  };
}

function buildBody(title: string, chapters: KnowledgeCaseChapters): string {
  const headings: Record<keyof KnowledgeCaseChapters, string> = {
    claim: 'Claim',
    scopeExclusions: 'Scope + Exclusions',
    symptoms: 'Symptoms',
    evidence: 'Evidence',
    rootCause: 'RootCause',
    experimentVerification: 'Experiment + Verification',
    fix: 'Fix',
    negative: 'Negative',
    openChallenges: 'OpenChallenges',
    derived: 'Derived',
  };
  const parts = [`# ${title}`];
  for (const key of KNOWLEDGE_CASE_CHAPTERS) {
    const content = chapters[key];
    if (content) parts.push(`## ${headings[key]}\n\n${content}`);
  }
  return parts.join('\n\n');
}

export function ingestColdData(source: string, options: {
  spaceId?: string;
  sessionId?: string;
  existingCaseIds?: Iterable<string>;
  availableAssetNames?: Iterable<string>;
} = {}): ColdDataIngestResult {
  const none: ColdDataIngestResult = {
    status: 'quarantine',
    candidateCreated: false,
    lifecycle: null,
    verified: false,
    missingAssets: [],
  };
  if (SECRET_RE.test(source)) {
    return { ...none, reason: 'secret-detected' };
  }
  if (containsAbsolutePath(source)) {
    return { ...none, reason: 'absolute-path' };
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(source);
  } catch {
    return { ...none, reason: 'yaml-broken' };
  }
  const doc = asRecord(parsed);
  if (Object.keys(doc).length === 0) {
    return { ...none, reason: 'yaml-broken' };
  }
  const caseId = readString(doc.case_id) || readString(doc.caseId);
  const title = readString(doc.title);
  if (!caseId || !title) {
    return { ...none, reason: 'yaml-broken' };
  }
  if (options.existingCaseIds && new Set(options.existingCaseIds).has(caseId)) {
    return {
      status: 'conflict',
      candidateCreated: false,
      lifecycle: 'draft',
      verified: false,
      existingCaseId: caseId,
      missingAssets: [],
      reason: 'duplicate-case-id',
    };
  }
  for (const text of collectStrings(doc)) {
    if (SECRET_RE.test(text) || containsAbsolutePath(text)) {
      return { ...none, reason: SECRET_RE.test(text) ? 'secret-detected' : 'absolute-path' };
    }
  }
  const meta = asRecord(doc.meta);
  const sourceStatus = sanitizeProvenanceToken(readString(meta.status));
  const sanitizedCaseId = sanitizeProvenanceToken(caseId);
  if (!sanitizedCaseId) {
    return { ...none, reason: 'filename-leaked' };
  }
  const assets = collectAssets(doc.assets);
  const assetIds = new Map(assets.map((asset) => [asset.file, opaqueAssetId(asset.file)]));
  const available = new Set(options.availableAssetNames ?? assets.map((asset) => asset.file));
  const missingAssets = assets
    .filter((asset) => !available.has(asset.file))
    .map((asset) => assetIds.get(asset.file) ?? opaqueAssetId(asset.file));
  const redactedDoc = asRecord(redactValue(doc, assetIds));
  const scope = mapScope(asRecord(redactedDoc.environment));
  const sanitizedTitle = redactText(title, assetIds);
  const chapters = Object.fromEntries(
    Object.entries(buildChapters(redactedDoc, scope)).map(([key, value]) => [
      key,
      typeof value === 'string' ? redactText(value, assetIds) : value,
    ]),
  ) as KnowledgeCaseChapters;
  const spaceId = options.spaceId || 'staging';
  const relativePath = `cases/${sanitizedCaseId}.md`;
  const body = redactText(buildBody(sanitizedTitle, chapters), assetIds);
  const preview = redactText(sanitizedTitle, assetIds);
  const originals = assets.map((asset) => asset.file);
  const published = [
    sanitizedTitle,
    preview,
    body,
    sourceStatus,
    sanitizedCaseId,
    ...Object.values(chapters),
    ...missingAssets,
  ];
  if (originals.some((name) => published.some((text) => typeof text === 'string' && text.includes(name)))) {
    return { ...none, reason: 'filename-leaked' };
  }
  const record: KnowledgeCardRecord = {
    cardId: `${spaceId}:${relativePath}`,
    spaceId,
    relativePath,
    type: 'case',
    lifecycle: 'draft',
    title: sanitizedTitle,
    scope,
    relations: [],
    body,
    sourceStatus,
    caseId: sanitizedCaseId,
    chapters,
    preview,
  };
  const leaked = leakedSensitiveReason(sanitizedTitle, body, preview, ...Object.values(chapters));
  if (leaked) {
    return { ...none, reason: leaked };
  }
  return {
    status: 'draft',
    candidateCreated: false,
    lifecycle: 'draft',
    sourceStatus,
    verified: false,
    record,
    missingAssets,
    reason: missingAssets.length > 0 ? 'missing-assets' : undefined,
  };
}

export function coldDataContentId(bytes: Buffer | string): string {
  const digest = createHash('sha256').update(bytes).digest('hex');
  return digest.slice(0, 8);
}

export function hashColdDataBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function quarantine(reason: string): ColdDataIngestResult {
  return {
    status: 'quarantine',
    candidateCreated: false,
    lifecycle: null,
    verified: false,
    missingAssets: [],
    reason,
  };
}

export async function ingestColdDataFromPath(
  filePath: string,
  options: {
    spaceId?: string;
    sessionId?: string;
    existingCaseIds?: Iterable<string>;
    availableAssetNames?: Iterable<string>;
    maxBytes?: number;
    io?: ColdDataPathIo;
  } = {},
): Promise<ColdDataIngestResult> {
  const io = options.io ?? defaultPathIo;
  const maxBytes = options.maxBytes ?? COLD_DATA_MAX_BYTES;
  let preStat: ColdDataPathStat;
  try {
    preStat = await io.stat(filePath);
  } catch {
    return quarantine('source-unreadable');
  }
  if (preStat.size > maxBytes) {
    return quarantine('source-too-large');
  }
  let preBytes: Buffer;
  try {
    preBytes = await io.readFile(filePath);
  } catch {
    return quarantine('source-unreadable');
  }
  if (preBytes.length > maxBytes) {
    return quarantine('source-too-large');
  }
  const preHash = hashColdDataBytes(preBytes);
  let postStat: ColdDataPathStat;
  let postBytes: Buffer;
  try {
    postStat = await io.stat(filePath);
    postBytes = await io.readFile(filePath);
  } catch {
    return quarantine('source-changed');
  }
  if (postBytes.length > maxBytes) {
    return quarantine('source-too-large');
  }
  const postHash = hashColdDataBytes(postBytes);
  if (
    preHash !== postHash
    || Math.trunc(preStat.mtimeMs) !== Math.trunc(postStat.mtimeMs)
    || preStat.size !== postStat.size
    || preBytes.length !== postBytes.length
  ) {
    return quarantine('source-changed');
  }
  const result = ingestColdData(preBytes.toString('utf8'), options);
  if (result.status !== 'draft' || !result.record) {
    return result;
  }
  const sourceHash = preHash;
  const sourceMtimeMs = Math.trunc(preStat.mtimeMs);
  const sourceSize = preStat.size;
  result.record.sourceHash = sourceHash;
  result.record.sourceMtimeMs = sourceMtimeMs;
  result.record.sourceSize = sourceSize;
  return {
    ...result,
    sourceHash,
    sourceMtimeMs,
    sourceSize,
  };
}
