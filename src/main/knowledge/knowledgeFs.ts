import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { KnowledgeCardDetail, KnowledgeCardSummary, KnowledgeSpace } from '@shared/types/knowledge';
import { StorageIo } from '../sessions/StorageIo';
import type { ParsedKnowledgeSource } from './knowledgeCardSchema';
import { KnowledgeWriteIntegrityError, KnowledgeWritePathError } from './knowledgeErrors';

const PREVIEW_MAX_CHARS = 160;
const MAX_WALK_DEPTH = 8;

export const toPosixRelative = (value: string): string => value.split(path.sep).join('/');

export const isPathInside = (rootPath: string, targetPath: string): boolean => {
  const relative = path.relative(path.resolve(rootPath), path.resolve(targetPath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

export function extractPreview(body: string): string | undefined {
  const plain = body.replace(/^#+\s+.+$/gm, '').replace(/```[\s\S]*?```/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_`>#-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!plain) return undefined;
  return plain.length > PREVIEW_MAX_CHARS ? `${plain.slice(0, PREVIEW_MAX_CHARS - 1)}…` : plain;
}

export async function resolveWithinRoot(rootPath: string, relativePath: string): Promise<string> {
  const normalizedRelative = toPosixRelative(relativePath).replace(/^\/+/, '');
  if (!normalizedRelative || normalizedRelative.includes('\0') || normalizedRelative.split('/').includes('..')) {
    throw new Error('Invalid knowledge card path.');
  }
  const lexical = path.resolve(rootPath, ...normalizedRelative.split('/'));
  if (!isPathInside(rootPath, lexical)) throw new Error('Knowledge card path escaped its space root.');
  try {
    const realRoot = await fs.realpath(rootPath);
    const realTarget = await fs.realpath(lexical);
    if (!isPathInside(realRoot, realTarget)) throw new Error('Knowledge card path escaped its space root.');
    return realTarget;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('Knowledge card not found.');
    throw error;
  }
}

export async function walkMarkdownFiles(rootPath: string): Promise<{ realRoot: string; files: string[] }> {
  try { await fs.mkdir(rootPath, { recursive: true }); } catch { return { realRoot: rootPath, files: [] }; }
  let realRoot: string;
  try { realRoot = await fs.realpath(rootPath); } catch { return { realRoot: rootPath, files: [] }; }
  const files: string[] = [];
  const walk = async (absoluteDir: string, depth: number): Promise<void> => {
    if (depth > MAX_WALK_DEPTH) return;
    let entries: import('node:fs').Dirent[];
    try { entries = await fs.readdir(absoluteDir, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const absolute = path.join(absoluteDir, entry.name);
      let realAbsolute: string;
      try { realAbsolute = await fs.realpath(absolute); } catch { continue; }
      if (!isPathInside(realRoot, realAbsolute)) continue;
      if (entry.isDirectory()) { await walk(absolute, depth + 1); continue; }
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) files.push(absolute);
    }
  };
  await walk(realRoot, 0);
  return { realRoot, files };
}

export function toCardSummary(
  space: KnowledgeSpace,
  relativePath: string,
  parsed: ParsedKnowledgeSource,
  updatedAt: number,
): KnowledgeCardSummary {
  const preview = parsed.record.preview ?? extractPreview(parsed.body);
  return {
    cardId: parsed.record.cardId || `${space.spaceId}:${relativePath}`,
    spaceId: space.spaceId,
    relativePath,
    title: parsed.record.title,
    ...(preview ? { preview } : {}),
    updatedAt,
    ...(parsed.record.type ? { type: parsed.record.type } : {}),
    ...(parsed.record.lifecycle ? { lifecycle: parsed.record.lifecycle } : {}),
  };
}

async function lstatOrNull(target: string): Promise<import('node:fs').Stats | null> {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function assertNotLink(stat: import('node:fs').Stats, target: string): void {
  if (stat.isSymbolicLink()) {
    throw new KnowledgeWritePathError(`refusing symlink/junction write path ${target}.`);
  }
  if (stat.isFile() && stat.nlink > 1) {
    throw new KnowledgeWritePathError(`refusing hardlinked write path ${target} (nlink=${stat.nlink}).`);
  }
}

function sameNormalizedPath(left: string, right: string): boolean {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  if (process.platform === 'win32') {
    return resolvedLeft.normalize('NFC').toLowerCase() === resolvedRight.normalize('NFC').toLowerCase();
  }
  return resolvedLeft === resolvedRight;
}

function lexicalAncestorChain(absolute: string): string[] {
  const hops: string[] = [];
  let current = path.resolve(absolute);
  let parent = path.dirname(current);
  hops.unshift(current);
  while (parent !== current) {
    current = parent;
    hops.unshift(current);
    parent = path.dirname(current);
  }
  return hops;
}

async function assertLexicalAncestorsAreLinkFree(absolute: string): Promise<void> {
  for (const hop of lexicalAncestorChain(absolute)) {
    const stat = await lstatOrNull(hop);
    if (!stat) continue;
    assertNotLink(stat, hop);
    const real = await fs.realpath(hop);
    if (!sameNormalizedPath(real, hop)) {
      throw new KnowledgeWritePathError(`path escapes through a link at ${hop}.`);
    }
  }
}

export async function assertSafeKnowledgeWriteTarget(
  rootPath: string,
  relativePath: string,
): Promise<string> {
  const normalizedRelative = toPosixRelative(relativePath).replace(/^\/+/, '');
  if (!normalizedRelative || normalizedRelative.includes('\0') || normalizedRelative.split('/').includes('..')) {
    throw new KnowledgeWritePathError('relative path contains .., NUL, or is empty.');
  }
  const lexicalRoot = path.resolve(rootPath);
  await assertLexicalAncestorsAreLinkFree(lexicalRoot);
  await fs.mkdir(lexicalRoot, { recursive: true });
  const realRoot = await fs.realpath(lexicalRoot);
  if (!sameNormalizedPath(realRoot, lexicalRoot)) {
    throw new KnowledgeWritePathError(`space root realpath diverged from lexical path ${lexicalRoot}.`);
  }
  const lexical = path.resolve(lexicalRoot, ...normalizedRelative.split('/'));
  if (!isPathInside(lexicalRoot, lexical)) {
    throw new KnowledgeWritePathError('Knowledge card path escaped its space root.');
  }
  let current = lexicalRoot;
  for (const part of path.relative(lexicalRoot, lexical).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = await lstatOrNull(current);
    if (!stat) continue;
    assertNotLink(stat, current);
  }
  return lexical;
}

export async function writeKnowledgeCardAtomic(
  absolutePath: string,
  contents: string,
  storage = new StorageIo(),
): Promise<void> {
  storage.writeUtf8AtomicFsync(absolutePath, contents);
  const written = await fs.readFile(absolutePath, 'utf8');
  const expected = createHash('sha256').update(contents, 'utf8').digest('hex');
  const actual = createHash('sha256').update(written, 'utf8').digest('hex');
  if (expected !== actual) {
    throw new KnowledgeWriteIntegrityError(`post-write hash mismatch for ${absolutePath}.`);
  }
  const writtenStat = await fs.lstat(absolutePath);
  assertNotLink(writtenStat, absolutePath);
}

export function toCardDetail(
  space: KnowledgeSpace,
  relativePath: string,
  parsed: ParsedKnowledgeSource,
  updatedAt: number,
): KnowledgeCardDetail {
  return {
    ...toCardSummary(space, relativePath, parsed, updatedAt),
    content: parsed.body,
    body: parsed.record.body ?? parsed.body,
    scope: parsed.record.scope ?? {},
    relations: parsed.record.relations ?? [],
    ...(parsed.record.sourceStatus ? { sourceStatus: parsed.record.sourceStatus } : {}),
    ...(parsed.record.caseId ? { caseId: parsed.record.caseId } : {}),
    ...(parsed.record.chapters ? { chapters: parsed.record.chapters } : {}),
  };
}

