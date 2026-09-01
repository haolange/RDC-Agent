import { z } from 'zod';
import {
  KNOWLEDGE_CARD_TYPES,
  KNOWLEDGE_CASE_CHAPTERS,
  KNOWLEDGE_LIFECYCLES,
  KNOWLEDGE_RELATION_KINDS,
  KNOWLEDGE_SCOPE_AXES,
  type KnowledgeCardRecord,
  type KnowledgeCaseChapters,
  type KnowledgeLifecycle,
  type KnowledgeRelation,
  type KnowledgeScope,
} from '@shared/types/knowledge';
import { parse as parseYaml } from 'yaml';

const optionalString = z.string().trim().min(1).optional();

export const KnowledgeScopeSchema = z.object({
  project: optionalString,
  engine: optionalString,
  engineVersion: optionalString,
  api: optionalString,
  platform: optionalString,
  gpuVendor: optionalString,
  gpuArch: optionalString,
  device: optionalString,
  driver: optionalString,
  capture: optionalString,
  pipelineStage: optionalString,
  pass: optionalString,
  shaderFamily: optionalString,
  materialFamily: optionalString,
  quality: optionalString,
  resolution: optionalString,
  featureConfiguration: optionalString,
  exclusions: z.record(z.enum(KNOWLEDGE_SCOPE_AXES), z.array(z.string().trim().min(1))).optional(),
}).strict();

export const KnowledgeRelationSchema = z.object({
  kind: z.enum(KNOWLEDGE_RELATION_KINDS),
  targetCardId: z.string().trim().min(1),
}).strict();

export const KnowledgeCaseChaptersSchema = z.object({
  claim: optionalString,
  scopeExclusions: optionalString,
  symptoms: optionalString,
  evidence: optionalString,
  rootCause: optionalString,
  experimentVerification: optionalString,
  fix: optionalString,
  negative: optionalString,
  openChallenges: optionalString,
  derived: optionalString,
}).strict();

export const KnowledgeCardRecordSchema = z.object({
  cardId: z.string().trim().min(1),
  spaceId: z.string().trim().min(1),
  relativePath: z.string().trim().min(1),
  type: z.enum(KNOWLEDGE_CARD_TYPES),
  lifecycle: z.enum(KNOWLEDGE_LIFECYCLES),
  title: z.string().trim().min(1),
  scope: KnowledgeScopeSchema.default({}),
  relations: z.array(KnowledgeRelationSchema).default([]),
  body: z.string(),
  preview: optionalString,
  updatedAt: z.number().int().nonnegative().optional(),
  sourceStatus: optionalString,
  caseId: optionalString,
  chapters: KnowledgeCaseChaptersSchema.optional(),
}).strict();

export function splitFrontmatter(source: string): { rawMeta: string | null; body: string } {
  const normalized = source.replace(/^\uFEFF/, '');
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { rawMeta: null, body: normalized.trim() };
  return { rawMeta: match[1], body: match[2].trim() };
}

export function parseLooseMeta(rawMeta: string): Record<string, unknown> {
  try {
    const parsed = parseYaml(rawMeta);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through to line parser
  }
  const meta: Record<string, unknown> = {};
  for (const line of rawMeta.split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const raw = line.slice(separator + 1).trim();
    try { meta[key] = JSON.parse(raw); } catch { meta[key] = raw; }
  }
  return meta;
}

export interface ParsedKnowledgeSource {
  meta: Record<string, unknown>;
  body: string;
  record: Pick<KnowledgeCardRecord, 'cardId' | 'title' | 'body' | 'preview'> & Partial<KnowledgeCardRecord>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function extractTitle(meta: Record<string, unknown>, body: string, fallback: string): string {
  const titled = readString(meta.title);
  if (titled) return titled;
  const heading = body.match(/^#\s+(.+)$/m);
  return heading?.[1]?.trim() || fallback;
}

function parseScope(raw: unknown): KnowledgeScope {
  const parsed = KnowledgeScopeSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
}

function parseRelations(raw: unknown): KnowledgeRelation[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const parsed = KnowledgeRelationSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

function parseChapters(raw: unknown, body: string): KnowledgeCaseChapters | undefined {
  const fromMeta = KnowledgeCaseChaptersSchema.safeParse(raw ?? {});
  const chapters: KnowledgeCaseChapters = fromMeta.success ? { ...fromMeta.data } : {};
  const headingMap: Record<string, keyof KnowledgeCaseChapters> = {
    claim: 'claim',
    'scope + exclusions': 'scopeExclusions',
    'scope+exclusions': 'scopeExclusions',
    scope: 'scopeExclusions',
    symptoms: 'symptoms',
    evidence: 'evidence',
    rootcause: 'rootCause',
    'root cause': 'rootCause',
    experiment: 'experimentVerification',
    verification: 'experimentVerification',
    'experiment + verification': 'experimentVerification',
    fix: 'fix',
    negative: 'negative',
    openchallenges: 'openChallenges',
    'open challenges': 'openChallenges',
    derived: 'derived',
  };
  const sections = body.split(/^##\s+/m).slice(1);
  for (const section of sections) {
    const newline = section.indexOf('\n');
    const title = (newline < 0 ? section : section.slice(0, newline)).trim().toLowerCase();
    const content = (newline < 0 ? '' : section.slice(newline + 1)).trim();
    const key = headingMap[title];
    if (key && content && !chapters[key]) chapters[key] = content;
  }
  return Object.keys(chapters).length > 0 ? chapters : undefined;
}

export function missingCaseChapters(chapters: KnowledgeCaseChapters | undefined): string[] {
  return KNOWLEDGE_CASE_CHAPTERS.filter((chapter) => !chapters?.[chapter]?.trim());
}

export function parseKnowledgeFrontmatter(source: string, options: {
  spaceId?: string;
  relativePath?: string;
  fallbackTitle?: string;
} = {}): ParsedKnowledgeSource {
  const { rawMeta, body } = splitFrontmatter(source);
  const meta = rawMeta ? parseLooseMeta(rawMeta) : {};
  const relativePath = options.relativePath?.replace(/^\/+/, '') || 'untitled.md';
  const spaceId = options.spaceId || 'user';
  const title = extractTitle(meta, body, options.fallbackTitle || relativePath.replace(/\.md$/i, ''));
  const typeParsed = z.enum(KNOWLEDGE_CARD_TYPES).safeParse(meta.type);
  const lifecycleParsed = z.enum(KNOWLEDGE_LIFECYCLES).safeParse(meta.lifecycle);
  const record: ParsedKnowledgeSource['record'] = {
    cardId: readString(meta.cardId) || `${spaceId}:${relativePath}`,
    spaceId,
    relativePath,
    title,
    body,
    scope: parseScope(meta.scope),
    relations: parseRelations(meta.relations),
    sourceStatus: readString(meta.sourceStatus) || readString(asRecord(meta.meta).status),
    caseId: readString(meta.caseId) || readString(meta.case_id),
  };
  if (typeParsed.success) record.type = typeParsed.data;
  if (lifecycleParsed.success) record.lifecycle = lifecycleParsed.data;
  if (record.type === 'case') record.chapters = parseChapters(meta.chapters, body);
  return { meta, body, record };
}

export function serializeKnowledgeCard(record: KnowledgeCardRecord): string {
  const frontmatter = {
    cardId: record.cardId,
    type: record.type,
    lifecycle: record.lifecycle,
    title: record.title,
    scope: record.scope,
    relations: record.relations,
    ...(record.sourceStatus ? { sourceStatus: record.sourceStatus } : {}),
    ...(record.caseId ? { caseId: record.caseId } : {}),
    ...(record.chapters ? { chapters: record.chapters } : {}),
  };
  const yamlLines = [
    `cardId: ${JSON.stringify(frontmatter.cardId)}`,
    `type: ${JSON.stringify(frontmatter.type)}`,
    `lifecycle: ${JSON.stringify(frontmatter.lifecycle)}`,
    `title: ${JSON.stringify(frontmatter.title)}`,
    `scope: ${JSON.stringify(frontmatter.scope)}`,
    `relations: ${JSON.stringify(frontmatter.relations)}`,
  ];
  if (record.sourceStatus) yamlLines.push(`sourceStatus: ${JSON.stringify(record.sourceStatus)}`);
  if (record.caseId) yamlLines.push(`caseId: ${JSON.stringify(record.caseId)}`);
  if (record.chapters) yamlLines.push(`chapters: ${JSON.stringify(record.chapters)}`);
  return `---\n${yamlLines.join('\n')}\n---\n\n${record.body.trim()}\n`;
}

export function normalizeLifecycle(value: unknown, fallback: KnowledgeLifecycle = 'draft'): KnowledgeLifecycle {
  const parsed = z.enum(KNOWLEDGE_LIFECYCLES).safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

export function isStructuredCard(record: ParsedKnowledgeSource['record']): record is KnowledgeCardRecord {
  return Boolean(record.type && record.lifecycle && record.cardId && record.spaceId && record.relativePath && record.title);
}
