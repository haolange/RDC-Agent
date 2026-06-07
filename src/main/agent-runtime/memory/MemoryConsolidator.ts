/**
 * MemoryConsolidator — Dream 机制：周期性整理、合并、清理记忆。
 *
 * 触发时机建议：当记忆条数超过阈值（默认 10）时，由 agent loop 在
 * 一轮工具调用结束后调用 `consolidate()`，避免索引爆炸。
 *
 * 该模块仅依赖注入的 `queryLlm`，不耦合具体 Provider 实现。
 */

import type { MemoryRecord } from './MemoryStore';
import { MemoryStore } from './MemoryStore';

/**
 * MemoryConsolidator 构造选项。
 */
export interface MemoryConsolidatorOptions {
  memoryStore: MemoryStore;
  queryLlm: (prompt: string) => Promise<string>;
  /** 触发整理的记忆数量阈值（含等于），默认 10。 */
  threshold?: number;
}

/**
 * 整理结果：被合并、被删除、被保留的记忆名称列表。
 */
export interface ConsolidateResult {
  /** 被合并的旧记忆 name 集合（合并完成后会被删除）。 */
  merged: string[];
  /** 被显式删除（过时/冗余）的记忆 name 集合。 */
  deleted: string[];
  /** 整理后实际存在于存储中的记忆 name 集合。 */
  kept: string[];
}

/** 整理 prompt 中可携带的总文本上限，避免 token 超限。 */
const MAX_CATALOG_CHARS = 16000;

const DEFAULT_THRESHOLD = 10;

/**
 * 解析 LLM 返回的整理指令；预期形如：
 * `{ "merge": [["a", "b"]], "delete": ["c"] }`
 *
 * 每个 merge 子数组列出需要合并的 name 列表，首个 name 作为合并后的目标名。
 */
function parseConsolidatePlan(text: string): {
  merge: string[][];
  delete: string[];
} {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { merge: [], delete: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return { merge: [], delete: [] };
  }
  if (!parsed || typeof parsed !== 'object') return { merge: [], delete: [] };
  const obj = parsed as Record<string, unknown>;

  const merge: string[][] = [];
  if (Array.isArray(obj.merge)) {
    for (const group of obj.merge) {
      if (!Array.isArray(group)) continue;
      const names = group.filter((n): n is string => typeof n === 'string' && n.trim().length > 0);
      if (names.length < 2) continue;
      merge.push(names);
    }
  }

  const deleteList: string[] = Array.isArray(obj.delete)
    ? obj.delete.filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
    : [];

  return { merge, delete: deleteList };
}

/**
 * 整理器：基于全量记忆调用 LLM，得到合并/删除计划并落盘。
 */
export class MemoryConsolidator {
  private readonly memoryStore: MemoryStore;
  private readonly queryLlm: (prompt: string) => Promise<string>;
  private readonly threshold: number;

  constructor(options: MemoryConsolidatorOptions) {
    this.memoryStore = options.memoryStore;
    this.queryLlm = options.queryLlm;
    this.threshold = options.threshold ?? DEFAULT_THRESHOLD;
  }

  /**
   * 是否需要触发整理：当前记忆条数 ≥ 阈值。
   */
  async shouldConsolidate(): Promise<boolean> {
    const all = await this.memoryStore.listMemories();
    return all.length >= this.threshold;
  }

  /**
   * 执行整理流程。整理失败或 LLM 不返回有效计划时，原样返回空操作结果。
   */
  async consolidate(): Promise<ConsolidateResult> {
    const all = await this.memoryStore.listMemories();
    const empty: ConsolidateResult = {
      merged: [],
      deleted: [],
      kept: all.map((m) => m.name),
    };
    if (all.length === 0) return empty;

    const catalog = all
      .map(
        (record) =>
          `## ${record.name}\n` +
          `description: ${record.description}\n` +
          `type: ${record.type}\n` +
          `${record.content}`,
      )
      .join('\n\n')
      .slice(0, MAX_CATALOG_CHARS);

    const prompt =
      'Consolidate the following memory entries. Rules:\n' +
      '1. Merge duplicates or strongly overlapping entries into one.\n' +
      '2. Remove outdated or contradicted entries.\n' +
      '3. Preserve important user preferences above all.\n' +
      'Return ONLY a JSON object of the shape:\n' +
      '{ "merge": [["nameA", "nameB"]], "delete": ["nameC"] }\n' +
      'Each merge group lists the names to combine; the first name will be reused as the merged record name.\n' +
      'If no change is needed, return { "merge": [], "delete": [] }.\n\n' +
      `Memories:\n${catalog}`;

    let response: string;
    try {
      response = await this.queryLlm(prompt);
    } catch {
      return empty;
    }

    const plan = parseConsolidatePlan(response);
    const byName = new Map(all.map((m) => [m.name, m] as const));
    const merged: string[] = [];
    const deleted: string[] = [];

    // 1) 执行合并
    for (const group of plan.merge) {
      const sources = group
        .map((name) => byName.get(name))
        .filter((m): m is MemoryRecord => Boolean(m));
      if (sources.length < 2) continue;

      const target = sources[0];
      const mergedContent = sources
        .map((m) => `### ${m.name}\n${m.description}\n\n${m.content}`)
        .join('\n\n---\n\n');
      const mergedTags = Array.from(
        new Set(sources.flatMap((m) => m.tags ?? []).filter((t) => t)),
      );

      // 写入合并后的目标记忆（覆盖同 slug）。
      await this.memoryStore.writeMemory({
        name: target.name,
        description: target.description,
        type: target.type,
        content: mergedContent,
        tags: mergedTags.length > 0 ? mergedTags : undefined,
      });

      // 删除被合并掉的其它源（跳过目标自己）。
      for (const source of sources.slice(1)) {
        const ok = await this.memoryStore.deleteMemory(source.name);
        if (ok) {
          merged.push(source.name);
          byName.delete(source.name);
        }
      }
    }

    // 2) 执行删除
    for (const name of plan.delete) {
      if (!byName.has(name)) continue;
      const ok = await this.memoryStore.deleteMemory(name);
      if (ok) {
        deleted.push(name);
        byName.delete(name);
      }
    }

    // 3) 重建索引（writeMemory / deleteMemory 已分别调用，这里再补一次确保最终状态）。
    await this.memoryStore.rebuildIndex();

    const final = await this.memoryStore.listMemories();
    return {
      merged,
      deleted,
      kept: final.map((m) => m.name),
    };
  }
}
