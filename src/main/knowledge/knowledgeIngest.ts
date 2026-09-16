import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  KNOWLEDGE_CASE_CHAPTERS,
  type KnowledgeCardRecord,
  type KnowledgeCaseChapters,
  type KnowledgeImageRef,
  type KnowledgeImportItem,
  type KnowledgeImportResult,
  type KnowledgeImportStatus,
  type KnowledgeScope,
} from '@shared/types/knowledge';
import { KNOWLEDGE_PACKAGE_SCHEMA } from '@shared/types/knowledgeExport';
import {
  isKnowledgeImageFileName,
  knowledgeImageDestination,
  knowledgeImageRoleFromAsset,
  sanitizeKnowledgeImages,
  KNOWLEDGE_IMAGE_MAX_BYTES,
} from './knowledgeImages';
import {
  isZipBuffer,
  pickKnowledgeYamlEntry,
  unzipKnowledgeFiles,
  utf8FromZip,
  KNOWLEDGE_PACKAGE_ZIP_MAX_UNCOMPRESSED,
} from './knowledgeZip';

export type { KnowledgeImportItem, KnowledgeImportResult, KnowledgeImportStatus };

function quarantineItem(reason: string): KnowledgeImportItem {
  return {
    status: 'quarantine',
    lifecycle: null,
    missingAssets: [],
    reason,
  };
}

function quarantineResult(reason: string): KnowledgeImportResult {
  return {
    candidateCreated: false,
    verified: false,
    items: [quarantineItem(reason)],
  };
}

function fromItems(items: KnowledgeImportItem[], extra: Partial<KnowledgeImportResult> = {}): KnowledgeImportResult {
  return {
    candidateCreated: false,
    verified: false,
    items,
    ...extra,
  };
}

export const KNOWLEDGE_IMPORT_MAX_BYTES = 2 * 1024 * 1024;

const SECRET_RE = /\b(api[_-]?key|password|secret|credential|authorization|bearer\s+[a-z0-9._+\-/=]+)\b/i;
const DRIVE_ABS_RE = /(?<![A-Za-z0-9/])[A-Za-z]:[/\\]/;
const UNC_ABS_RE = /\\\\/;
const POSIX_ABS_RE = /(?:^|[\s"'`([{,:=])\/[A-Za-z0-9._-]+/;

export function containsAbsolutePath(text: string): boolean {
  return DRIVE_ABS_RE.test(text) || UNC_ABS_RE.test(text) || POSIX_ABS_RE.test(text);
}

/** Single secret matcher shared by import and export, so both refuse the same content. */
export function hasKnowledgeSecret(text: string): boolean {
  return SECRET_RE.test(text);
}

function leakedSensitiveReason(...texts: Array<string | undefined>): 'secret-detected' | 'absolute-path' | null {
  for (const text of texts) {
    if (!text) continue;
    if (SECRET_RE.test(text)) return 'secret-detected';
    if (containsAbsolutePath(text)) return 'absolute-path';
  }
  return null;
}

export interface KnowledgeImportPathStat {
  mtimeMs: number;
  size: number;
}

export interface KnowledgeImportPathIo {
  stat(filePath: string): Promise<KnowledgeImportPathStat>;
  readFile(filePath: string): Promise<Buffer>;
}

const defaultPathIo: KnowledgeImportPathIo = {
  stat: async (filePath) => {
    const stat = await fs.stat(filePath);
    return { mtimeMs: stat.mtimeMs, size: stat.size };
  },
  readFile: (filePath) => fs.readFile(filePath),
};

export interface KnowledgeImportAssetRef {
  file: string;
  role?: string;
}

export interface KnowledgeStagedImage {
  relativePath: string;
  role: KnowledgeImageRef['role'];
  bytes: Buffer;
  sha256: string;
}

export interface KnowledgeImportPathResult extends KnowledgeImportResult {
  stagedImagesByCardId?: Map<string, KnowledgeStagedImage[]>;
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

function stripLeftoverFilenames(text: string, keep: Iterable<string> = []): string {
  const tokens = [...keep].filter(Boolean).sort((left, right) => right.length - left.length);
  const placeholders = new Map<string, string>();
  let protectedText = text;
  tokens.forEach((token, index) => {
    const mark = `\u0000KEEP${index}\u0000`;
    placeholders.set(mark, token);
    protectedText = protectedText.split(token).join(mark);
  });
  FILENAME_TOKEN_RE.lastIndex = 0;
  let stripped = protectedText.replace(FILENAME_TOKEN_RE, '').replace(/[ \t]{2,}/g, ' ');
  for (const [mark, token] of placeholders) stripped = stripped.split(mark).join(token);
  return stripped;
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
  return stripLeftoverFilenames(replaceMappedNames(text, mapping), mapping.values());
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

function collectAssets(raw: unknown): KnowledgeImportAssetRef[] {
  const assets: KnowledgeImportAssetRef[] = [];
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
        });
        return;
      }
      for (const nested of Object.values(row)) visit(nested);
    }
  };
  visit(raw);
  return assets;
}

function mapDeclaredAssets(assets: KnowledgeImportAssetRef[], caseId: string): {
  mapping: Map<string, string>;
  images: KnowledgeImageRef[];
} {
  const mapping = new Map<string, string>();
  const images: KnowledgeImageRef[] = [];
  const used = new Set<string>();
  for (const asset of assets) {
    if (isKnowledgeImageFileName(asset.file)) {
      const role = knowledgeImageRoleFromAsset(asset.role);
      const dest = knowledgeImageDestination(caseId, role, asset.file, used);
      mapping.set(asset.file, dest);
      images.push({ relativePath: dest, role });
      continue;
    }
    mapping.set(asset.file, opaqueAssetId(asset.file));
  }
  return { mapping, images };
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

/**
 * Knowledge packages produced by export come back in as ordinary session
 * drafts. The package `lifecycle` is metadata only: nothing re-enters as
 * verified, and a duplicate cardId takes the same conflict path as case YAML.
 */
export function ingestKnowledgePackage(doc: Record<string, unknown>, options: {
  spaceId?: string;
  existingCardIds?: Iterable<string>;
  existingCaseIds?: Iterable<string>;
  availableImagePaths?: Iterable<string>;
}): KnowledgeImportResult {
  const cards = Array.isArray(doc.cards) ? doc.cards : [];
  if (cards.length === 0) return quarantineResult('yaml-broken');

  const spaceId = options.spaceId || 'staging';
  const existing = new Set([
    ...options.existingCardIds ?? [],
    ...options.existingCaseIds ?? [],
  ]);
  const availableImages = options.availableImagePaths ? new Set(options.availableImagePaths) : null;
  const items: KnowledgeImportItem[] = [];

  for (const raw of cards) {
    const card = asRecord(raw);
    const title = readString(card.title);
    const relativePath = readString(card.relativePath);
    if (!title || !relativePath) {
      items.push(quarantineItem('yaml-broken'));
      continue;
    }
    const caseId = readString(card.caseId);
    const cardId = `${spaceId}:${relativePath}`;
    if (existing.has(cardId) || (caseId && existing.has(caseId))) {
      items.push({
        status: 'conflict',
        lifecycle: 'draft',
        missingAssets: [],
        reason: 'duplicate-case-id',
        ...(caseId ? { existingCaseId: caseId } : {}),
      });
      continue;
    }
    const images = sanitizeKnowledgeImages(
      Array.isArray(card.images) ? card.images as KnowledgeImageRef[] : undefined,
      relativePath,
      caseId,
    );
    const missingAssets = availableImages
      ? images.filter((image) => !availableImages.has(image.relativePath)).map((image) => image.relativePath)
      : images.map((image) => image.relativePath);
    const record: KnowledgeCardRecord = {
      cardId,
      spaceId,
      relativePath,
      type: (readString(card.type) as KnowledgeCardRecord['type']) ?? 'fact',
      lifecycle: 'draft',
      title,
      scope: asRecord(card.scope) as KnowledgeScope,
      relations: [],
      body: readString(card.body) ?? '',
      preview: title,
      ...(readString(card.sourceStatus) ? { sourceStatus: readString(card.sourceStatus) } : {}),
      ...(caseId ? { caseId } : {}),
      ...(card.chapters ? { chapters: asRecord(card.chapters) as KnowledgeCaseChapters } : {}),
      ...(images.length > 0 ? { images } : {}),
    };
    items.push({
      status: 'draft',
      lifecycle: 'draft',
      record,
      missingAssets,
      ...(readString(card.sourceStatus) ? { sourceStatus: readString(card.sourceStatus) } : {}),
      ...(missingAssets.length > 0 ? { reason: 'missing-assets' } : {}),
    });
    existing.add(cardId);
  }

  return fromItems(items);
}

export function ingestKnowledge(source: string, options: {
  spaceId?: string;
  sessionId?: string;
  existingCaseIds?: Iterable<string>;
  existingCardIds?: Iterable<string>;
  availableAssetNames?: Iterable<string>;
  availableImagePaths?: Iterable<string>;
} = {}): KnowledgeImportResult {
  if (SECRET_RE.test(source)) {
    return quarantineResult('secret-detected');
  }
  if (containsAbsolutePath(source)) {
    return quarantineResult('absolute-path');
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(source);
  } catch {
    return quarantineResult('yaml-broken');
  }
  const doc = asRecord(parsed);
  if (Object.keys(doc).length === 0) {
    return quarantineResult('yaml-broken');
  }
  if (readString(doc.schema) === KNOWLEDGE_PACKAGE_SCHEMA) {
    return ingestKnowledgePackage(doc, {
      ...(options.spaceId ? { spaceId: options.spaceId } : {}),
      ...(options.existingCardIds ? { existingCardIds: options.existingCardIds } : {}),
      ...(options.existingCaseIds ? { existingCaseIds: options.existingCaseIds } : {}),
      ...(options.availableImagePaths ? { availableImagePaths: options.availableImagePaths } : {}),
    });
  }
  const caseId = readString(doc.case_id) || readString(doc.caseId);
  const title = readString(doc.title);
  if (!caseId || !title) {
    return quarantineResult('yaml-broken');
  }
  if (options.existingCaseIds && new Set(options.existingCaseIds).has(caseId)) {
    return fromItems([{
      status: 'conflict',
      lifecycle: 'draft',
      existingCaseId: caseId,
      missingAssets: [],
      reason: 'duplicate-case-id',
    }]);
  }
  for (const text of collectStrings(doc)) {
    if (SECRET_RE.test(text) || containsAbsolutePath(text)) {
      return quarantineResult(SECRET_RE.test(text) ? 'secret-detected' : 'absolute-path');
    }
  }
  const meta = asRecord(doc.meta);
  const sourceStatus = sanitizeProvenanceToken(readString(meta.status));
  const sanitizedCaseId = sanitizeProvenanceToken(caseId);
  if (!sanitizedCaseId) {
    return quarantineResult('filename-leaked');
  }
  const assets = collectAssets(doc.assets);
  const { mapping, images } = mapDeclaredAssets(assets, sanitizedCaseId);
  const available = new Set(options.availableAssetNames ?? []);
  const missingAssets = assets
    .filter((asset) => !available.has(asset.file))
    .map((asset) => mapping.get(asset.file) ?? opaqueAssetId(asset.file));
  const redactedDoc = asRecord(redactValue(doc, mapping));
  const scope = mapScope(asRecord(redactedDoc.environment));
  const sanitizedTitle = redactText(title, mapping);
  const chapters = Object.fromEntries(
    Object.entries(buildChapters(redactedDoc, scope)).map(([key, value]) => [
      key,
      typeof value === 'string' ? redactText(value, mapping) : value,
    ]),
  ) as KnowledgeCaseChapters;
  const spaceId = options.spaceId || 'staging';
  const relativePath = `cases/${sanitizedCaseId}.md`;
  const body = redactText(buildBody(sanitizedTitle, chapters), mapping);
  const preview = redactText(sanitizedTitle, mapping);
  const originals = assets.map((asset) => asset.file);
  const sanitizedImages = sanitizeKnowledgeImages(images, relativePath, sanitizedCaseId);
  const allowedPaths = new Set([
    ...mapping.values(),
    ...sanitizedImages.map((image) => image.relativePath),
  ]);
  const published = [
    sanitizedTitle,
    preview,
    body,
    sourceStatus,
    sanitizedCaseId,
    ...Object.values(chapters),
    ...missingAssets,
    ...sanitizedImages.map((image) => image.relativePath),
  ];
  const leakedOriginal = originals.some((name) => published.some((text) => {
    if (typeof text !== 'string' || !text.includes(name)) return false;
    return ![...allowedPaths].some((allowed) => text === allowed || text.includes(allowed));
  }));
  if (leakedOriginal) {
    return quarantineResult('filename-leaked');
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
    ...(sanitizedImages.length > 0 ? { images: sanitizedImages } : {}),
  };
  const leaked = leakedSensitiveReason(sanitizedTitle, body, preview, ...Object.values(chapters));
  if (leaked) {
    return quarantineResult(leaked);
  }
  return fromItems([{
    status: 'draft',
    lifecycle: 'draft',
    sourceStatus,
    record,
    missingAssets,
    ...(missingAssets.length > 0 ? { reason: 'missing-assets' } : {}),
  }]);
}

export function knowledgeImportContentId(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 8);
}

export function hashKnowledgeImportBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function quarantine(reason: string): KnowledgeImportResult {
  return quarantineResult(reason);
}

function siblingImageNames(yamlEntry: string, files: Iterable<string>): string[] {
  const slash = yamlEntry.lastIndexOf('/');
  const dir = slash >= 0 ? yamlEntry.slice(0, slash + 1) : '';
  const names: string[] = [];
  for (const name of files) {
    if (!name.startsWith(dir)) continue;
    const rest = name.slice(dir.length);
    if (!rest.includes('/') && isKnowledgeImageFileName(rest)) names.push(rest);
  }
  return names;
}

function stageImagesFromMap(
  items: KnowledgeImportItem[],
  files: Map<string, Uint8Array>,
  yamlEntry: string,
  parsed: Record<string, unknown>,
): Map<string, KnowledgeStagedImage[]> {
  const staged = new Map<string, KnowledgeStagedImage[]>();
  const slash = yamlEntry.lastIndexOf('/');
  const dir = slash >= 0 ? yamlEntry.slice(0, slash + 1) : '';
  for (const item of items) {
    if (item.status !== 'draft' || !item.record?.images?.length) continue;
    const destBySource = new Map<string, KnowledgeImageRef>();
    const used = new Set<string>();
    for (const asset of collectAssets(parsed.assets)) {
      if (!isKnowledgeImageFileName(asset.file)) continue;
      const dest = knowledgeImageDestination(item.record.caseId ?? 'case', knowledgeImageRoleFromAsset(asset.role), asset.file, used);
      const image = item.record.images.find((entry) => entry.relativePath === dest);
      if (image) destBySource.set(asset.file, image);
    }
    const collected: KnowledgeStagedImage[] = [];
    for (const image of item.record.images) {
      const sourceName = [...destBySource.entries()].find(([, dest]) => dest.relativePath === image.relativePath)?.[0];
      const data = files.get(image.relativePath)
        ?? (sourceName ? files.get(`${dir}${sourceName}`) : undefined);
      if (!data || data.byteLength > KNOWLEDGE_IMAGE_MAX_BYTES) continue;
      const bytes = Buffer.from(data);
      collected.push({
        relativePath: image.relativePath,
        role: image.role,
        bytes,
        sha256: hashKnowledgeImportBytes(bytes),
      });
    }
    if (collected.length > 0) staged.set(item.record.cardId, collected);
  }
  return staged;
}

function attachSourceProvenance(
  result: KnowledgeImportResult,
  sourceHash: string,
  sourceMtimeMs: number,
  sourceSize: number,
): KnowledgeImportResult {
  for (const item of result.items) {
    if (item.record) {
      item.record.sourceHash = sourceHash;
      item.record.sourceMtimeMs = sourceMtimeMs;
      item.record.sourceSize = sourceSize;
    }
  }
  return { ...result, sourceHash, sourceMtimeMs, sourceSize };
}

export async function ingestKnowledgeFromPath(
  filePath: string,
  options: {
    spaceId?: string;
    sessionId?: string;
    existingCaseIds?: Iterable<string>;
    existingCardIds?: Iterable<string>;
    availableAssetNames?: Iterable<string>;
    availableImagePaths?: Iterable<string>;
    maxBytes?: number;
    io?: KnowledgeImportPathIo;
  } = {},
): Promise<KnowledgeImportPathResult> {
  const io = options.io ?? defaultPathIo;
  const looksZip = filePath.toLowerCase().endsWith('.zip');
  const maxBytes = options.maxBytes ?? (looksZip ? KNOWLEDGE_PACKAGE_ZIP_MAX_UNCOMPRESSED : KNOWLEDGE_IMPORT_MAX_BYTES);
  let preStat: KnowledgeImportPathStat;
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
  const preHash = hashKnowledgeImportBytes(preBytes);
  let postStat: KnowledgeImportPathStat;
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
  const postHash = hashKnowledgeImportBytes(postBytes);
  if (
    preHash !== postHash
    || Math.trunc(preStat.mtimeMs) !== Math.trunc(postStat.mtimeMs)
    || preStat.size !== postStat.size
    || preBytes.length !== postBytes.length
  ) {
    return quarantine('source-changed');
  }

  const sourceHash = preHash;
  const sourceMtimeMs = Math.trunc(preStat.mtimeMs);
  const sourceSize = preStat.size;

  if (looksZip || isZipBuffer(preBytes)) {
    let files: Map<string, Uint8Array>;
    try {
      files = unzipKnowledgeFiles(preBytes);
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (code === 'KNOWLEDGE_ZIP_PATH_INVALID') return quarantine('zip-path-invalid');
      if (code === 'KNOWLEDGE_ZIP_TOO_LARGE') return quarantine('source-too-large');
      return quarantine('zip-invalid');
    }
    const yamlEntry = pickKnowledgeYamlEntry(files.keys());
    if (!yamlEntry) return quarantine('yaml-broken');
    const yamlBytes = files.get(yamlEntry);
    if (!yamlBytes) return quarantine('yaml-broken');
    const yamlText = utf8FromZip(yamlBytes);
    let parsed: Record<string, unknown> = {};
    try {
      parsed = asRecord(parseYaml(yamlText));
    } catch {
      parsed = {};
    }
    const availableAssetNames = options.availableAssetNames ?? siblingImageNames(yamlEntry, files.keys());
    const availableImagePaths = options.availableImagePaths ?? [...files.keys()].filter((name) => isKnowledgeImageFileName(name));
    const result = ingestKnowledge(yamlText, {
      ...options,
      availableAssetNames,
      availableImagePaths,
    });
    const stagedImagesByCardId = stageImagesFromMap(result.items, files, yamlEntry, parsed);
    return {
      ...attachSourceProvenance(result, sourceHash, sourceMtimeMs, sourceSize),
      ...(stagedImagesByCardId.size > 0 ? { stagedImagesByCardId } : {}),
    };
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(preBytes.toString('utf8'));
  } catch {
    parsed = {};
  }
  const doc = asRecord(parsed);
  const siblingDir = path.dirname(filePath);
  const available = new Set(options.availableAssetNames ?? []);
  const availableImages = new Set(options.availableImagePaths ?? []);
  if (!options.availableAssetNames) {
    for (const name of collectAssets(doc.assets).map((asset) => asset.file)) {
      try {
        await io.stat(path.join(siblingDir, name));
        available.add(name);
      } catch {
        // sibling absent
      }
    }
  }
  if (!options.availableImagePaths && readString(doc.schema) === KNOWLEDGE_PACKAGE_SCHEMA) {
    for (const raw of Array.isArray(doc.cards) ? doc.cards : []) {
      const images = sanitizeKnowledgeImages(
        Array.isArray(asRecord(raw).images) ? asRecord(raw).images as KnowledgeImageRef[] : undefined,
        readString(asRecord(raw).relativePath) ?? '',
        readString(asRecord(raw).caseId),
      );
      for (const image of images) {
        try {
          await io.stat(path.join(siblingDir, ...image.relativePath.split('/')));
          availableImages.add(image.relativePath);
        } catch {
          // image absent at package root
        }
      }
    }
  }
  const result = ingestKnowledge(preBytes.toString('utf8'), {
    ...options,
    availableAssetNames: available,
    ...(availableImages.size > 0 ? { availableImagePaths: availableImages } : {}),
  });
  const files = new Map<string, Uint8Array>();
  for (const item of result.items) {
    if (item.status !== 'draft' || !item.record?.images) continue;
    const destBySource = new Map<string, KnowledgeImageRef>();
    const used = new Set<string>();
    for (const asset of collectAssets(doc.assets)) {
      if (!isKnowledgeImageFileName(asset.file)) continue;
      const dest = knowledgeImageDestination(item.record.caseId ?? 'case', knowledgeImageRoleFromAsset(asset.role), asset.file, used);
      const image = item.record.images.find((entry) => entry.relativePath === dest);
      if (image) destBySource.set(asset.file, image);
    }
    for (const [sourceName, image] of destBySource) {
      if (!available.has(sourceName)) continue;
      try {
        const bytes = await io.readFile(path.join(siblingDir, sourceName));
        if (bytes.length > KNOWLEDGE_IMAGE_MAX_BYTES) continue;
        files.set(sourceName, bytes);
        files.set(image.relativePath, bytes);
      } catch {
        // sibling unreadable
      }
    }
    for (const image of item.record.images) {
      if (files.has(image.relativePath)) continue;
      try {
        const bytes = await io.readFile(path.join(siblingDir, ...image.relativePath.split('/')));
        if (bytes.length > KNOWLEDGE_IMAGE_MAX_BYTES) continue;
        files.set(image.relativePath, bytes);
      } catch {
        // package-relative image absent
      }
    }
  }
  const stagedImagesByCardId = stageImagesFromMap(result.items, files, path.basename(filePath), doc);
  return {
    ...attachSourceProvenance(result, sourceHash, sourceMtimeMs, sourceSize),
    ...(stagedImagesByCardId.size > 0 ? { stagedImagesByCardId } : {}),
  };
}
