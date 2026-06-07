/**
 * MemoryLoader — 按需选择与最近上下文相关的记忆。
 *
 * 设计原则：
 * - 仅在记忆数量超过 `maxItems` 时才需要 LLM side-query，
 *   避免每轮都付出额外推理成本；
 * - LLM 调用通过构造器注入（`queryLlm`），与具体 Provider 解耦；
 * - LLM 不可用时退化为关键词匹配，保证至少能召回一部分相关记忆。
 */

import type { MemoryRecord } from './MemoryStore';
import { MemoryStore } from './MemoryStore';

/**
 * MemoryLoader 构造选项。
 */
export interface MemoryLoaderOptions {
  /** 已初始化的 `MemoryStore` 实例。 */
  memoryStore: MemoryStore;
  /** 用于 side-query 的轻量 LLM 调用函数，输入完整 prompt，返回纯文本响应。 */
  queryLlm: (prompt: string) => Promise<string>;
  /** 最多返回多少条记忆，默认 5。 */
  maxItems?: number;
}

const DEFAULT_MAX_ITEMS = 5;

/**
 * 从 LLM 文本响应中提取首个 JSON 数组（粗粒度，但足够 side-query 场景使用）。
 */
function extractJsonArray(text: string): unknown[] | null {
  const match = text.match(/\[[\s\S]*?\]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 从近期上下文中提取关键字（长度 > 3 的小写词），用于降级匹配。
 */
function extractKeywords(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9\u4e00-\u9fff]+/)
        .filter((word) => word.length > 3),
    ),
  );
}

/**
 * 记忆加载器：依据近期对话内容挑选若干条相关记忆。
 */
export class MemoryLoader {
  private readonly memoryStore: MemoryStore;
  private readonly queryLlm: (prompt: string) => Promise<string>;
  private readonly maxItems: number;

  constructor(options: MemoryLoaderOptions) {
    this.memoryStore = options.memoryStore;
    this.queryLlm = options.queryLlm;
    this.maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;
  }

  /**
   * 选择与 `recentContext` 相关的记忆。
   *
   * 流程：
   * 1. 列出全部记忆，若数量 ≤ `maxItems`，直接全部返回；
   * 2. 否则构造 side-query prompt 调用 LLM，期待返回 JSON 数字数组（索引）；
   * 3. LLM 调用失败或解析失败时，退化为关键词匹配。
   */
  async selectRelevantMemories(recentContext: string): Promise<MemoryRecord[]> {
    const all = await this.memoryStore.listMemories();
    if (all.length === 0) return [];
    if (all.length <= this.maxItems) return all;

    const trimmed = recentContext.trim().slice(0, 2000);
    if (!trimmed) return [];

    const catalogLines = all.map(
      (record, index) => `${index}: ${record.name} — ${record.description}`,
    );
    const prompt =
      'Given the recent conversation and the memory catalog below, ' +
      'select the indices of memories that are clearly relevant. ' +
      'Return ONLY a JSON array of integers, e.g. [0, 3]. ' +
      'If none are relevant, return [].\n\n' +
      `Recent conversation:\n${trimmed}\n\n` +
      `Memory catalog:\n${catalogLines.join('\n')}`;

    try {
      const response = await this.queryLlm(prompt);
      const indices = extractJsonArray(response);
      if (indices) {
        const selected: MemoryRecord[] = [];
        for (const item of indices) {
          if (typeof item !== 'number' || !Number.isInteger(item)) continue;
          if (item < 0 || item >= all.length) continue;
          selected.push(all[item]);
          if (selected.length >= this.maxItems) break;
        }
        if (selected.length > 0) return selected;
      }
    } catch {
      // 落入下方的关键词匹配回退路径。
    }

    return this.fallbackByKeywords(all, trimmed);
  }

  /**
   * 关键词降级匹配：在记忆 name + description 中匹配近期上下文中出现的关键词。
   */
  private fallbackByKeywords(records: MemoryRecord[], context: string): MemoryRecord[] {
    const keywords = extractKeywords(context);
    if (keywords.length === 0) return [];
    const matched: MemoryRecord[] = [];
    for (const record of records) {
      const haystack = `${record.name} ${record.description}`.toLowerCase();
      if (keywords.some((kw) => haystack.includes(kw))) {
        matched.push(record);
        if (matched.length >= this.maxItems) break;
      }
    }
    return matched;
  }
}
