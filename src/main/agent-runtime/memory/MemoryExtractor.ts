/**
 * MemoryExtractor — 自动从对话中提炼新的记忆条目。
 *
 * 触发时机建议：每轮 agent loop 结束（`stop_reason !== 'tool_use'`）后调用一次。
 * 该模块仅返回候选记忆条目，由调用方决定是否真正写入 `MemoryStore`，
 * 以便上层根据策略做二次确认或批处理。
 */

import type { MemoryRecord } from './MemoryStore';
import { MemoryStore } from './MemoryStore';

/**
 * MemoryExtractor 构造选项。
 */
export interface MemoryExtractorOptions {
  memoryStore: MemoryStore;
  queryLlm: (prompt: string) => Promise<string>;
}

/**
 * 单条候选记忆（尚未写入磁盘）。
 */
export interface ExtractedMemory {
  name: string;
  description: string;
  type: MemoryRecord['type'];
  content: string;
}

/** 拼接对话时单条消息的最大字符数，避免 prompt 过长。 */
const MAX_DIALOGUE_CHARS = 4000;
/** extractor 只看最近多少条消息。 */
const RECENT_MESSAGE_COUNT = 10;

/**
 * 从 LLM 响应中提取首个 JSON 数组并返回原始 unknown 数组。
 */
function extractJsonArray(text: string): unknown[] | null {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 类型守卫：合法的记忆类别集合。
 */
function isValidType(value: unknown): value is MemoryRecord['type'] {
  return value === 'user' || value === 'feedback' || value === 'project' || value === 'reference';
}

/**
 * 将候选记忆原始对象规范化；非法或缺字段返回 null。
 */
function normalizeExtracted(item: unknown): ExtractedMemory | null {
  if (!item || typeof item !== 'object') return null;
  const record = item as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const description = typeof record.description === 'string' ? record.description.trim() : '';
  const rawType = record.type;
  const content =
    typeof record.content === 'string'
      ? record.content
      : typeof record.body === 'string'
        ? record.body
        : '';
  if (!name || !description || !content.trim()) return null;
  const type: MemoryRecord['type'] = isValidType(rawType) ? rawType : 'user';
  return { name, description, type, content: content.trim() };
}

/**
 * 提取器：调用注入的 LLM 从对话中归纳新的记忆候选。
 */
export class MemoryExtractor {
  private readonly memoryStore: MemoryStore;
  private readonly queryLlm: (prompt: string) => Promise<string>;

  constructor(options: MemoryExtractorOptions) {
    this.memoryStore = options.memoryStore;
    this.queryLlm = options.queryLlm;
  }

  /**
   * 从对话中抽取候选记忆。
   *
   * @param messages       原始对话（不含已压缩过的摘要），仅取最近若干条；
   * @param existingMemories  已存在的记忆，用于去重 + 提供 LLM 上下文。
   *                          若调用方未传入，会自动从 store 读取。
   */
  async extractFromConversation(
    messages: Array<{ role: string; content: string }>,
    existingMemories?: MemoryRecord[],
  ): Promise<ExtractedMemory[]> {
    const recent = messages.slice(-RECENT_MESSAGE_COUNT);
    const dialogue = recent
      .map((msg) => {
        const content = typeof msg.content === 'string' ? msg.content.trim() : '';
        if (!content) return '';
        return `${msg.role}: ${content}`;
      })
      .filter((line) => line.length > 0)
      .join('\n');

    if (!dialogue.trim()) return [];

    const existing = existingMemories ?? (await this.memoryStore.listMemories());
    const existingDesc =
      existing.length > 0
        ? existing.map((m) => `- ${m.name}: ${m.description}`).join('\n')
        : '(none)';

    const prompt =
      'Extract user preferences, constraints, or project facts from this dialogue.\n' +
      'Return a JSON array. Each item: {name, type, description, content}.\n' +
      "- name: short kebab-case identifier (e.g. 'user-preference-tabs')\n" +
      "- type: one of 'user' (user preference), 'feedback' (guidance), " +
      "'project' (project fact), 'reference' (external pointer)\n" +
      '- description: one-line summary for index lookup\n' +
      '- content: full detail in markdown\n' +
      'If nothing new or already covered by existing memories, return [].\n\n' +
      `Existing memories:\n${existingDesc}\n\n` +
      `Dialogue:\n${dialogue.slice(0, MAX_DIALOGUE_CHARS)}`;

    let response: string;
    try {
      response = await this.queryLlm(prompt);
    } catch {
      return [];
    }

    const items = extractJsonArray(response);
    if (!items) return [];

    const existingNames = new Set(existing.map((m) => m.name));
    const seenNames = new Set<string>();
    const results: ExtractedMemory[] = [];
    for (const raw of items) {
      const normalized = normalizeExtracted(raw);
      if (!normalized) continue;
      if (existingNames.has(normalized.name)) continue;
      if (seenNames.has(normalized.name)) continue;
      seenNames.add(normalized.name);
      results.push(normalized);
    }
    return results;
  }
}
