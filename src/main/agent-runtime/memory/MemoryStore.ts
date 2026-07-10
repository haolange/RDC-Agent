import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference';
export interface MemoryRecord { id: string; name: string; description: string; type: MemoryType; content: string; tags?: string[]; createdAt: number; updatedAt: number; }
export interface WriteMemoryInput { name: string; description: string; type: MemoryType; content: string; tags?: string[]; }

const slugify = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
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
const serialize = (record: MemoryRecord): string => ['---', `id: ${JSON.stringify(record.id)}`, `name: ${JSON.stringify(record.name)}`, `description: ${JSON.stringify(record.description)}`, `type: ${JSON.stringify(record.type)}`, `tags: ${JSON.stringify(record.tags ?? [])}`, `createdAt: ${record.createdAt}`, `updatedAt: ${record.updatedAt}`, '---', '', record.content.trim(), ''].join('\n');

/** Explicit file-backed memory store. It never builds or injects a global index. */
export class MemoryStore {
  constructor(private readonly memoryDir: string) {}
  getMemoryDir(): string { return this.memoryDir; }

  async writeMemory(input: WriteMemoryInput): Promise<MemoryRecord> {
    const name = slugify(input.name);
    if (!name) throw new Error('Memory name must contain at least one ASCII letter or digit.');
    if (!input.description.trim() || !input.content.trim()) throw new Error('Memory description and content are required.');
    await fs.mkdir(this.memoryDir, { recursive: true });
    const existing = await this.getMemory(name);
    const now = Date.now();
    const record: MemoryRecord = { id: existing?.id ?? `mem_${now}_${randomBytes(4).toString('hex')}`, name, description: input.description.trim(), type: input.type, content: input.content.trim(), tags: input.tags?.map((tag) => tag.trim()).filter(Boolean), createdAt: existing?.createdAt ?? now, updatedAt: now };
    await fs.writeFile(path.join(this.memoryDir, `${name}.md`), serialize(record), 'utf8');
    return record;
  }

  async deleteMemory(name: string): Promise<boolean> {
    const slug = slugify(name);
    if (!slug) return false;
    try { await fs.unlink(path.join(this.memoryDir, `${slug}.md`)); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  }

  async getMemory(name: string): Promise<MemoryRecord | null> {
    const slug = slugify(name);
    if (!slug) return null;
    try {
      const { meta, body } = parseFrontmatter(await fs.readFile(path.join(this.memoryDir, `${slug}.md`), 'utf8'));
      const candidateType = String(meta.type ?? 'reference');
      const type: MemoryType = ['user', 'feedback', 'project', 'reference'].includes(candidateType) ? candidateType as MemoryType : 'reference';
      return { id: String(meta.id ?? slug), name: String(meta.name ?? slug), description: String(meta.description ?? ''), type, content: body, tags: Array.isArray(meta.tags) ? meta.tags.map(String) : undefined, createdAt: Number(meta.createdAt ?? 0), updatedAt: Number(meta.updatedAt ?? 0) };
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }

  async listMemories(): Promise<MemoryRecord[]> {
    let entries: string[];
    try { entries = await fs.readdir(this.memoryDir); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const records = await Promise.all(entries.filter((entry) => entry.endsWith('.md')).map((entry) => this.getMemory(entry.slice(0, -3))));
    return records.filter((record): record is MemoryRecord => Boolean(record)).sort((left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name));
  }

  async searchMemories(query: string, limit = 20): Promise<MemoryRecord[]> {
    const needle = query.trim().toLocaleLowerCase();
    return (await this.listMemories()).filter((record) => !needle || [record.name, record.description, record.content, ...(record.tags ?? [])].some((value) => value.toLocaleLowerCase().includes(needle))).slice(0, Math.max(1, Math.min(limit, 100)));
  }
}
