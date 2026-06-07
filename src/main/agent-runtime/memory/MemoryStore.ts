/**
 * MemoryStore — 跨会话持久化记忆存储。
 *
 * 文件布局（默认 `.rdc-agent/memory/` 相对工作区根）：
 * - `MEMORY.md`：索引文件，由 `rebuildIndex` 自动重建，
 *   每条记忆一行 `- [slug](slug.md) — description`，可注入 system prompt。
 * - `{slug}.md`：单条记忆文件，YAML frontmatter + Markdown 正文。
 *
 * 该模块只负责存储与索引，不直接调用 LLM；
 * LLM 相关能力由 `MemoryLoader` / `MemoryExtractor` / `MemoryConsolidator` 注入。
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * 一条持久化记忆的结构化表示。
 */
export interface MemoryRecord {
  /** 内部唯一 ID，形如 `mem_${timestamp}_${hex}`。 */
  id: string;
  /** Slug 标识（kebab-case，如 `user-preference-tabs`）。 */
  name: string;
  /** 一行描述，用于索引与 side-query 匹配。 */
  description: string;
  /** 记忆类别。 */
  type: 'user' | 'feedback' | 'project' | 'reference';
  /** Markdown 正文。 */
  content: string;
  /** 可选标签。 */
  tags?: string[];
  /** 创建时间戳（毫秒）。 */
  createdAt: number;
  /** 最近一次更新时间戳（毫秒）。 */
  updatedAt: number;
}

/**
 * 写入记忆时的输入参数。
 */
export interface WriteMemoryInput {
  name: string;
  description: string;
  type: MemoryRecord['type'];
  content: string;
  tags?: string[];
}

/** 索引文件名，不参与记忆扫描。 */
const INDEX_FILENAME = 'MEMORY.md';

/**
 * 将名称归一化为 slug（小写、连字符、仅保留 a-z0-9-）。
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * 简易 frontmatter 解析。仅支持 `key: value` 行；
 * value 优先尝试 `JSON.parse`（便于解析数组、数字、布尔），失败则保留原始字符串。
 */
function parseFrontmatter(content: string): { meta: Record<string, unknown>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };
  const meta: Record<string, unknown> = {};
  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx <= 0) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    try {
      meta[key] = JSON.parse(value);
    } catch {
      // 去掉单/双引号包裹
      meta[key] = value.replace(/^['"]|['"]$/g, '');
    }
  }
  return { meta, body: match[2].trim() };
}

/**
 * 序列化 frontmatter 值。字符串原样输出，其它类型走 `JSON.stringify`。
 */
function serializeFrontmatterValue(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/**
 * 构造 YAML frontmatter + Markdown 正文的完整文件内容。
 */
function buildMemoryFile(record: MemoryRecord): string {
  const lines: string[] = ['---'];
  lines.push(`id: ${serializeFrontmatterValue(record.id)}`);
  lines.push(`name: ${serializeFrontmatterValue(record.name)}`);
  lines.push(`description: ${serializeFrontmatterValue(record.description)}`);
  lines.push(`type: ${serializeFrontmatterValue(record.type)}`);
  if (record.tags && record.tags.length > 0) {
    lines.push(`tags: ${JSON.stringify(record.tags)}`);
  }
  lines.push(`createdAt: ${record.createdAt}`);
  lines.push(`updatedAt: ${record.updatedAt}`);
  lines.push('---');
  lines.push('');
  lines.push(record.content.trim());
  lines.push('');
  return lines.join('\n');
}

/**
 * 记忆存储器。负责文件读写、索引重建、记忆查询等基础操作。
 */
export class MemoryStore {
  private readonly memoryDir: string;

  /**
   * @param memoryDir 记忆文件所在目录。建议传入绝对路径（例如
   *                  `path.join(workspaceRoot, '.rdc-agent', 'memory')`）。
   */
  constructor(memoryDir: string) {
    this.memoryDir = memoryDir;
  }

  /**
   * 获取存储目录路径。
   */
  getMemoryDir(): string {
    return this.memoryDir;
  }

  /**
   * 写入一条新的记忆，并重建索引。
   *
   * - ID 由 `mem_${Date.now()}_${hex}` 生成；
   * - 文件名采用 slug 化的 `name`，重复写入会覆盖同名文件并保留原始 `createdAt`。
   */
  async writeMemory(input: WriteMemoryInput): Promise<MemoryRecord> {
    await this.ensureDir();
    const slug = slugify(input.name);
    if (!slug) {
      throw new Error(`MemoryStore.writeMemory: 无法将 name="${input.name}" 转为有效 slug`);
    }
    const filePath = path.join(this.memoryDir, `${slug}.md`);
    const now = Date.now();

    // 若已存在同 slug 的记忆，保留原始 id / createdAt，仅更新内容与时间戳。
    let existing: MemoryRecord | null = null;
    try {
      existing = await this.parseMemoryFile(filePath);
    } catch {
      existing = null;
    }

    const record: MemoryRecord = {
      id: existing?.id ?? `mem_${now}_${randomBytes(4).toString('hex')}`,
      name: slug,
      description: input.description,
      type: input.type,
      content: input.content,
      tags: input.tags,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    await fs.writeFile(filePath, buildMemoryFile(record), 'utf8');
    await this.rebuildIndex();
    return record;
  }

  /**
   * 删除指定 slug 名称的记忆文件，并重建索引。
   * @returns 是否真的删除成功（文件不存在时返回 false）。
   */
  async deleteMemory(name: string): Promise<boolean> {
    const slug = slugify(name);
    if (!slug) return false;
    const filePath = path.join(this.memoryDir, `${slug}.md`);
    try {
      await fs.unlink(filePath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return false;
      throw err;
    }
    await this.rebuildIndex();
    return true;
  }

  /**
   * 按 slug 名称读取单条记忆。
   * @returns 不存在或无法解析时返回 `null`。
   */
  async getMemory(name: string): Promise<MemoryRecord | null> {
    const slug = slugify(name);
    if (!slug) return null;
    const filePath = path.join(this.memoryDir, `${slug}.md`);
    try {
      return await this.parseMemoryFile(filePath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return null;
      return null;
    }
  }

  /**
   * 列出全部记忆（不含 `MEMORY.md` 索引文件），按 name 排序返回。
   */
  async listMemories(): Promise<MemoryRecord[]> {
    await this.ensureDir();
    let entries: string[] = [];
    try {
      entries = await fs.readdir(this.memoryDir);
    } catch {
      return [];
    }
    const records: MemoryRecord[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue;
      if (entry === INDEX_FILENAME) continue;
      const filePath = path.join(this.memoryDir, entry);
      try {
        const record = await this.parseMemoryFile(filePath);
        records.push(record);
      } catch {
        // 跳过解析失败的文件，避免单个坏文件污染整个索引。
      }
    }
    records.sort((a, b) => a.name.localeCompare(b.name));
    return records;
  }

  /**
   * 根据当前目录下所有记忆文件重建 `MEMORY.md` 索引。
   */
  async rebuildIndex(): Promise<void> {
    await this.ensureDir();
    const records = await this.listMemories();
    const lines = records.map(
      (record) => `- [${record.name}](${record.name}.md) — ${record.description}`,
    );
    const indexPath = path.join(this.memoryDir, INDEX_FILENAME);
    const content = lines.length > 0 ? `${lines.join('\n')}\n` : '';
    await fs.writeFile(indexPath, content, 'utf8');
  }

  /**
   * 返回 `MEMORY.md` 当前内容，便于注入 system prompt。
   * 文件缺失时返回空字符串。
   */
  async getIndexContent(): Promise<string> {
    const indexPath = path.join(this.memoryDir, INDEX_FILENAME);
    try {
      const text = await fs.readFile(indexPath, 'utf8');
      return text.trim();
    } catch {
      return '';
    }
  }

  /**
   * 解析单个记忆文件为 `MemoryRecord`。
   * 缺失字段会被赋予合理默认值（保证向前兼容）。
   */
  private async parseMemoryFile(filePath: string): Promise<MemoryRecord> {
    const raw = await fs.readFile(filePath, 'utf8');
    const { meta, body } = parseFrontmatter(raw);

    const fallbackName = path.basename(filePath, '.md');
    const name = typeof meta.name === 'string' && meta.name ? meta.name : fallbackName;
    const description =
      typeof meta.description === 'string' ? meta.description : body.split(/\r?\n/)[0] ?? '';
    const rawType = typeof meta.type === 'string' ? meta.type : 'user';
    const type: MemoryRecord['type'] = (
      ['user', 'feedback', 'project', 'reference'] as const
    ).includes(rawType as MemoryRecord['type'])
      ? (rawType as MemoryRecord['type'])
      : 'user';

    const tags = Array.isArray(meta.tags)
      ? meta.tags.filter((item): item is string => typeof item === 'string')
      : undefined;

    const createdAt =
      typeof meta.createdAt === 'number' ? meta.createdAt : Number(meta.createdAt) || Date.now();
    const updatedAt =
      typeof meta.updatedAt === 'number' ? meta.updatedAt : Number(meta.updatedAt) || createdAt;

    const id =
      typeof meta.id === 'string' && meta.id
        ? meta.id
        : `mem_${createdAt}_${randomBytes(4).toString('hex')}`;

    return {
      id,
      name,
      description,
      type,
      content: body,
      tags,
      createdAt,
      updatedAt,
    };
  }

  /**
   * 确保记忆目录存在。
   */
  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.memoryDir, { recursive: true });
  }
}
