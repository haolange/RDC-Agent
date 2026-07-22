import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  KnowledgeCardDetail,
  KnowledgeCardSummary,
  KnowledgeSpace,
} from '@shared/types/knowledge';
import { appPathService } from './AppPathService';
import { storageAdapter } from '../sessions/StorageAdapter';

const USER_SPACE_ID = 'user';
const PREVIEW_MAX_CHARS = 160;
const MAX_WALK_DEPTH = 8;
const toPosixRelative = (value: string): string => value.split(path.sep).join('/');
const isPathInside = (rootPath: string, targetPath: string): boolean => {
  const relative = path.relative(path.resolve(rootPath), path.resolve(targetPath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const parseFrontmatter = (source: string): { meta: Record<string, unknown>; body: string } => {
  const normalized = source.replace(/^\uFEFF/, '');
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: normalized.trim() };
  const meta: Record<string, unknown> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const raw = line.slice(separator + 1).trim();
    try { meta[key] = JSON.parse(raw); } catch { meta[key] = raw; }
  }
  return { meta, body: match[2].trim() };
};


const extractTitle = (meta: Record<string, unknown>, body: string, fileName: string): string => {
  if (typeof meta.title === 'string' && meta.title.trim()) return meta.title.trim();
  const heading = body.match(/^#\s+(.+)$/m);
  return heading?.[1]?.trim() || fileName.replace(/\.md$/i, '');
};

const extractPreview = (body: string): string | undefined => {
  const plain = body.replace(/^#+\s+.+$/gm, '').replace(/```[\s\S]*?```/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_`>#-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!plain) return undefined;
  return plain.length > PREVIEW_MAX_CHARS ? `${plain.slice(0, PREVIEW_MAX_CHARS - 1)}…` : plain;
};

const resolveWithinRoot = async (rootPath: string, relativePath: string): Promise<string> => {
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
};

async function walkMarkdownFiles(rootPath: string): Promise<{ realRoot: string; files: string[] }> {
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

export class KnowledgeBrowseService {
  listSpaces(): KnowledgeSpace[] {
    const spaces: KnowledgeSpace[] = [{
      spaceId: USER_SPACE_ID, kind: 'user', label: 'User', rootPath: appPathService.getUserRdxPaths().knowledgePath,
    }];
    for (const project of storageAdapter.listProjects()) {
      spaces.push({
        spaceId: `project:${project.projectId}`, kind: 'project', label: project.name,
        rootPath: project.knowledgePath, projectId: project.projectId,
      });
    }
    return spaces;
  }

  private spaceById(spaceId: string): KnowledgeSpace {
    const space = this.listSpaces().find((entry) => entry.spaceId === spaceId);
    if (!space) throw new Error(`Unknown knowledge space: ${spaceId}`);
    return space;
  }

  async listCards(spaceId: string): Promise<KnowledgeCardSummary[]> {
    const space = this.spaceById(spaceId);
    const { realRoot, files } = await walkMarkdownFiles(space.rootPath);
    const cards: KnowledgeCardSummary[] = [];
    for (const absolutePath of files) {
      const relativePath = toPosixRelative(path.relative(realRoot, absolutePath));
      if (!relativePath || relativePath.startsWith('..')) continue;
      try {
        const source = await fs.readFile(absolutePath, 'utf8');
        const { meta, body } = parseFrontmatter(source);
        const stats = await fs.stat(absolutePath);
        const preview = extractPreview(body);
        cards.push({
          cardId: `${space.spaceId}:${relativePath}`, spaceId: space.spaceId, relativePath,
          title: extractTitle(meta, body, path.basename(absolutePath)),
          ...(preview ? { preview } : {}), updatedAt: Math.trunc(stats.mtimeMs),
        });
      } catch { /* skip unreadable files in browse listing */ }
    }
    return cards.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  }

  async getCard(spaceId: string, relativePath: string): Promise<KnowledgeCardDetail | null> {
    const space = this.spaceById(spaceId);
    let absolutePath: string;
    try { absolutePath = await resolveWithinRoot(space.rootPath, relativePath); }
    catch (error) {
      if (error instanceof Error && error.message === 'Knowledge card not found.') return null;
      throw error;
    }
    try {
      const source = await fs.readFile(absolutePath, 'utf8');
      const { meta, body } = parseFrontmatter(source);
      const stats = await fs.stat(absolutePath);
      const normalizedRelative = toPosixRelative(relativePath).replace(/^\/+/, '');
      const preview = extractPreview(body);
      return {
        cardId: `${space.spaceId}:${normalizedRelative}`, spaceId: space.spaceId,
        relativePath: normalizedRelative, title: extractTitle(meta, body, path.basename(absolutePath)),
        ...(preview ? { preview } : {}), updatedAt: Math.trunc(stats.mtimeMs), content: body,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
}

export const knowledgeBrowseService = new KnowledgeBrowseService();
