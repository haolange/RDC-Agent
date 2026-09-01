import { createHash } from 'node:crypto';
import { parse as parseYaml } from 'yaml';
import {
  KNOWLEDGE_CASE_CHAPTERS,
  type ColdDataIngestResult,
  type KnowledgeCardRecord,
  type KnowledgeCaseChapters,
  type KnowledgeScope,
} from '@shared/types/knowledge';

export type { ColdDataIngestResult, ColdDataIngestStatus } from '@shared/types/knowledge';

const SECRET_RE = /\b(api[_-]?key|password|secret|credential|authorization|bearer\s+[a-z0-9._+\-/=]+)\b/i;
const ABSOLUTE_PATH_RE = /(?:[A-Za-z]:\\|\/(?:Users|home|root|tmp)\/|\\\\)/;

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
  if (ABSOLUTE_PATH_RE.test(source)) {
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
    if (SECRET_RE.test(text) || ABSOLUTE_PATH_RE.test(text)) {
      return { ...none, reason: SECRET_RE.test(text) ? 'secret-detected' : 'absolute-path' };
    }
  }
  const meta = asRecord(doc.meta);
  const sourceStatus = readString(meta.status);
  const assets = collectAssets(doc.assets);
  const available = new Set(options.availableAssetNames ?? assets.map((asset) => asset.file));
  const missingAssets = assets.filter((asset) => !available.has(asset.file)).map((asset) => asset.file);
  const scope = mapScope(asRecord(doc.environment));
  const chapters = buildChapters(doc, scope);
  const spaceId = options.spaceId || 'staging';
  const relativePath = `cases/${caseId}.md`;
  const body = buildBody(title, chapters);
  const record: KnowledgeCardRecord = {
    cardId: `${spaceId}:${relativePath}`,
    spaceId,
    relativePath,
    type: 'case',
    lifecycle: 'draft',
    title,
    scope,
    relations: [],
    body,
    sourceStatus,
    caseId,
    chapters,
    preview: title,
  };
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
