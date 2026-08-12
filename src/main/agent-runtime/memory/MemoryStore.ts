import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { withMemoryDirectoryLock } from './memoryDirectoryLock';

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference';
export interface MemoryRecord { id: string; name: string; displayName: string; normalizedName: string; description: string; type: MemoryType; content: string; tags?: string[]; createdAt: number; updatedAt: number; }
export interface WriteMemoryInput { name: string; description: string; type: MemoryType; content: string; tags?: string[]; }

const hashSlug = (value: string): string => createHash('sha256').update(value).digest('hex');

const directoryWriteQueues = new Map<string, Promise<void>>();

const LIST_MAX_FILES = 500;
const LIST_MAX_FILE_BYTES = 512 * 1024;
const LIST_CONCURRENCY = 8;

async function withDirectoryMutex<T>(
  memoryDir: string,
  operation: () => Promise<T>,
): Promise<T> {
  // Resolve the lock key after creating the directory so two MemoryStore
  // instances (including symlinked aliases) share one physical mutex.
  await fs.mkdir(memoryDir, { recursive: true });
  const realMemoryDir = await fs.realpath(memoryDir);
  const previous = directoryWriteQueues.get(realMemoryDir) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => current);
  directoryWriteQueues.set(realMemoryDir, tail);
  await previous;
  try {
    return await withMemoryDirectoryLock(realMemoryDir, operation);
  } finally {
    release();
    if (directoryWriteQueues.get(realMemoryDir) === tail) {
      directoryWriteQueues.delete(realMemoryDir);
    }
  }
}

/**
 * Unicode-aware slugify: keep letters/numbers across scripts (\p{L}\p{N}),
 * collapse separators, and fall back to a short hash when the result is empty.
 */
export const slugify = (value: string): string => {
  const normalized = value.normalize('NFKC').trim().toLowerCase();
  const slug = normalized
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (slug.length > 0) {
    return slug.length > 80 ? `${slug.slice(0, 64)}-${hashSlug(normalized).slice(0, 8)}` : slug;
  }
  return `mem-${hashSlug(normalized || value).slice(0, 16)}`;
};

/** Resolve a unique slug when an existing file already owns a colliding slug for a different source name. */
export const resolveSlugCollision = async (
  baseSlug: string,
  sourceName: string,
  exists: (slug: string) => Promise<boolean>,
): Promise<string> => {
  if (!(await exists(baseSlug))) return baseSlug;
  const candidate = `${baseSlug.slice(0, 64)}-${hashSlug(sourceName).slice(0, 8)}`;
  if (!(await exists(candidate))) return candidate;
  let n = 2;
  while (await exists(`${candidate}-${n}`)) n += 1;
  return `${candidate}-${n}`;
};

const parseFrontmatter = (source: string): { meta: Record<string, unknown>; body: string } => {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: source.trim() };
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
const serialize = (record: MemoryRecord): string => ['---', `id: ${JSON.stringify(record.id)}`, `name: ${JSON.stringify(record.name)}`, `displayName: ${JSON.stringify(record.displayName)}`, `normalizedName: ${JSON.stringify(record.normalizedName)}`, `description: ${JSON.stringify(record.description)}`, `type: ${JSON.stringify(record.type)}`, `tags: ${JSON.stringify(record.tags ?? [])}`, `createdAt: ${record.createdAt}`, `updatedAt: ${record.updatedAt}`, '---', '', record.content.trim(), ''].join('\n');

function assertMemoryPathContained(memoryDir: string, targetPath: string): void {
  const root = path.resolve(memoryDir);
  const resolved = path.resolve(targetPath);
  const relative = path.relative(root, resolved);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`MEMORY_PATH_ESCAPE: path escaped memory directory: ${targetPath}`);
  }
}

async function replaceFileAtomic(target: string, temporary: string): Promise<void> {
  try {
    await fs.rename(temporary, target);
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST' && code !== 'EPERM') throw error;
  }

  const bakPath = `${target}.bak.${process.pid}.${randomBytes(4).toString('hex')}`;
  try {
    await fs.rename(target, bakPath);
  } catch (bakError) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw bakError;
  }

  try {
    await fs.rename(temporary, target);
  } catch (finalError) {
    try {
      await fs.rename(bakPath, target);
    } catch {
      // Leave bak for recovery if restore fails.
    }
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw finalError;
  }

  await fs.rm(bakPath, { force: true }).catch(() => undefined);
}

/** Explicit file-backed memory store. It never builds or injects a global index. */
export class MemoryStore {
  constructor(private readonly memoryDir: string) {}
  getMemoryDir(): string { return this.memoryDir; }

  private resolveMemoryFilePath(slug: string): string {
    if (!slug || slug.includes('/') || slug.includes('\\') || slug.includes('\0') || slug === '.' || slug === '..') {
      throw new Error(`MEMORY_INVALID_SLUG: ${slug}`);
    }
    const target = path.join(this.memoryDir, `${slug}.md`);
    assertMemoryPathContained(this.memoryDir, target);
    return target;
  }

  async writeMemory(input: WriteMemoryInput): Promise<MemoryRecord> {
    return withDirectoryMutex(this.memoryDir, () => this.writeMemoryUnsafe(input));
  }

  private async writeMemoryUnsafe(input: WriteMemoryInput): Promise<MemoryRecord> {
    const sourceName = input.name.trim();
    if (!sourceName) throw new Error('Memory name is required.');
    if (!input.description.trim() || !input.content.trim()) {
      throw new Error('Memory description and content are required.');
    }
    await fs.mkdir(this.memoryDir, { recursive: true });
    const baseSlug = slugify(sourceName);
    const normalizedSourceName = sourceName.normalize('NFKC').trim().toLowerCase();
    let existingOwner: MemoryRecord | null = null;
    try {
      const entries = await fs.readdir(this.memoryDir);
      for (const entry of entries) {
        if (!entry.endsWith('.md')) continue;
        const candidate = await this.readMemoryFile(entry.slice(0, -3));
        if (candidate && (candidate.displayName === sourceName || candidate.normalizedName === normalizedSourceName)) {
          existingOwner = candidate;
          break;
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const sameOwner = Boolean(existingOwner);
    const name = sameOwner
      ? existingOwner!.name
      : await resolveSlugCollision(baseSlug, sourceName, async (slug) => {
          try {
            await fs.access(this.resolveMemoryFilePath(slug));
            return true;
          } catch {
            return false;
          }
        });
    const prior = existingOwner;
    const now = Date.now();
    const record: MemoryRecord = {
      id: prior?.id ?? `mem_${now}_${randomBytes(4).toString('hex')}`,
      name,
      displayName: sourceName,
      normalizedName: sourceName.normalize('NFKC').trim().toLowerCase(),
      description: input.description.trim(),
      type: input.type,
      content: input.content.trim(),
      tags: input.tags?.map((tag) => tag.trim()).filter(Boolean),
      createdAt: prior?.createdAt ?? now,
      updatedAt: now,
    };
    const target = this.resolveMemoryFilePath(name);
    const temporary = `${target}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await fs.writeFile(temporary, serialize(record), { encoding: 'utf8', mode: 0o600 });
      await replaceFileAtomic(target, temporary);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
    return record;
  }

  async deleteMemory(name: string): Promise<boolean> {
    return withDirectoryMutex(this.memoryDir, async () => {
      const record = await this.getMemory(name);
      if (!record) return false;
      try {
        await fs.unlink(this.resolveMemoryFilePath(record.name));
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      }
    });
  }

  private async readMemoryFile(slug: string): Promise<MemoryRecord | null> {
    try {
      const filePath = this.resolveMemoryFilePath(slug);
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) return null;
      if (stats.size > LIST_MAX_FILE_BYTES) {
        console.warn(`[MemoryStore] skipping oversized memory file: ${filePath} (${stats.size} bytes)`);
        return null;
      }
      const { meta, body } = parseFrontmatter(await fs.readFile(filePath, 'utf8'));
      const candidateType = String(meta.type ?? 'reference');
      const type: MemoryType = ['user', 'feedback', 'project', 'reference'].includes(candidateType)
        ? candidateType as MemoryType
        : 'reference';
      // Disk filename slug is the sole path authority; frontmatter name is display-only when it differs.
      const displayName = String(meta.displayName ?? meta.name ?? slug);
      return {
        id: String(meta.id ?? slug),
        name: slug,
        displayName,
        normalizedName: String(meta.normalizedName ?? displayName.normalize('NFKC').trim().toLowerCase()),
        description: String(meta.description ?? ''),
        type,
        content: body,
        tags: Array.isArray(meta.tags) ? meta.tags.map(String) : undefined,
        createdAt: Number(meta.createdAt ?? 0),
        updatedAt: Number(meta.updatedAt ?? 0),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      if (error instanceof Error && error.message.startsWith('MEMORY_')) {
        console.warn(`[MemoryStore] ${error.message}`);
        return null;
      }
      throw error;
    }
  }

  async getMemory(name: string): Promise<MemoryRecord | null> {
    const requested = name.trim();
    const normalized = requested.normalize('NFKC').toLowerCase();
    const slug = slugify(requested);
    const direct = await this.readMemoryFile(slug);
    const findCollisionOwner = async (): Promise<MemoryRecord | null> => {
      let entries: string[];
      try {
        entries = await fs.readdir(this.memoryDir);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
      for (const entry of entries) {
        if (!entry.endsWith('.md')) continue;
        const candidate = await this.readMemoryFile(entry.slice(0, -3));
        if (candidate && (
          candidate.displayName === requested
          || candidate.normalizedName === normalized
        )) {
          return candidate;
        }
      }
      return null;
    };
    if (!direct) return findCollisionOwner();
    if (direct.displayName === requested || direct.normalizedName === normalized || direct.name === requested) {
      return direct;
    }
    // A normalized slug may be owned by another display name (for example
    // "A B" versus "A-B"). Resolve the requested owner without overwriting.
    return (await findCollisionOwner()) ?? (direct.name === requested ? direct : null);
  }

  async listMemories(): Promise<MemoryRecord[]> {
    let entries: string[];
    try { entries = await fs.readdir(this.memoryDir); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }

    const mdEntries = entries.filter((entry) => entry.endsWith('.md')).slice(0, LIST_MAX_FILES);
    if (entries.filter((entry) => entry.endsWith('.md')).length > LIST_MAX_FILES) {
      console.warn(`[MemoryStore] listMemories truncated to ${LIST_MAX_FILES} files under ${this.memoryDir}`);
    }

    const records: MemoryRecord[] = [];
    let nextIndex = 0;
    const worker = async (): Promise<void> => {
      while (nextIndex < mdEntries.length) {
        const index = nextIndex;
        nextIndex += 1;
        const entry = mdEntries[index]!;
        const record = await this.readMemoryFile(entry.slice(0, -3));
        if (record) records.push(record);
      }
    };
    const workerCount = Math.min(LIST_CONCURRENCY, mdEntries.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return records.sort((left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name));
  }

  async searchMemories(query: string, limit = 20): Promise<MemoryRecord[]> {
    const needle = query.trim().toLocaleLowerCase();
    return (await this.listMemories()).filter((record) => !needle || [record.name, record.displayName, record.normalizedName, record.description, record.content, ...(record.tags ?? [])].some((value) => value.toLocaleLowerCase().includes(needle))).slice(0, Math.max(1, Math.min(limit, 100)));
  }
}
