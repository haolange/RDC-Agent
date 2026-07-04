/**
 * PromptAssembler — 动态组装 system prompt，附带进程内缓存。
 *
 * 设计要点：
 * - 按 {@link PromptSection} 顺序拼接段落，跳过返回 `null` 的段落。
 * - 使用 `\n\n` 连接相邻段落，保持可读性。
 * - 在静态段落（identity / capabilities / tools / workspace）与
 *   动态段落（memory / rules / context）之间插入
 *   {@link DYNAMIC_BOUNDARY} 标记，便于 LLM 端的 prompt cache 优化。
 * - 缓存以 `JSON.stringify(context)` 的 SHA-256 作为 key，
 *   最多保留 {@link MAX_CACHE_ENTRIES} 条，使用最简单的插入序淘汰。
 */

import { createHash } from 'node:crypto';

import {
  DEFAULT_SECTIONS,
  DEFAULT_STATIC_SECTION_COUNT,
  sectionMemory,
  sectionRules,
  type PromptContext,
  type PromptSection,
} from './PromptSections';

/** 各语义分段的字符数量（用于 breakdown token 估算）。 */
export interface PromptSectionMetrics {
  /** 所有非 rules/memory 段落的字符合计（identity、instructions、capabilities 等）。 */
  system_prompt: number;
  /** sectionRules 输出的字符数。 */
  rules: number;
  /** sectionMemory 输出的字符数。 */
  memory_files: number;
}

/**
 * 静态前缀与动态后缀的分隔标记。
 *
 * 该标记同时存在于完整 prompt 与 {@link PromptAssembler.getStaticPrefix}
 * 返回的字符串末尾，便于上层精准切分。
 */
export const DYNAMIC_BOUNDARY = '\n<!-- DYNAMIC_CONTENT_BELOW -->\n';

/**
 * 组装器配置。
 */
export interface PromptAssemblerOptions {
  /** 段落列表，默认使用 {@link DEFAULT_SECTIONS}。 */
  sections?: PromptSection[];
  /**
   * 静态段落数量（前 N 个段落属于静态前缀，其余为动态后缀）。
   * 仅在显式传入 `sections` 时建议同时指定。
   */
  staticSectionCount?: number;
  /** 启用缓存，默认 `true`。 */
  enableCache?: boolean;
}

/** 段落分组结果。 */
interface SectionGroups {
  /** 静态段落渲染后的非空文本片段。 */
  staticParts: string[];
  /** 动态段落渲染后的非空文本片段。 */
  dynamicParts: string[];
}

/** 缓存条目上限。 */
const MAX_CACHE_ENTRIES = 10;

/** Intermediate vs final visible output constraints for multi-loop agent runs. */
const LOOP_OUTPUT_GUIDANCE = `# Loop Output
- During an agent run, keep intermediate visible commentary to one or two short sentences that explain the next action.
- Do not emit long-form prose or final-answer body text until the run is finishing with no further tool calls.
- Reserve detailed final answers for the closing turn when you are ready to respond to the user.`;

/**
 * 系统提示词组装器。
 *
 * 同一实例可被多次调用；通过 {@link invalidateCache} 主动清除缓存。
 */
export class PromptAssembler {
  private readonly sections: PromptSection[];
  private readonly staticSectionCount: number;
  private readonly enableCache: boolean;
  private readonly cache: Map<string, string>;

  constructor(options: PromptAssemblerOptions = {}) {
    this.sections = options.sections ?? DEFAULT_SECTIONS;
    this.staticSectionCount = Math.max(
      0,
      Math.min(
        options.staticSectionCount ?? DEFAULT_STATIC_SECTION_COUNT,
        this.sections.length,
      ),
    );
    this.enableCache = options.enableCache ?? true;
    this.cache = new Map<string, string>();
  }

  /**
   * 组装完整的 system prompt。
   *
   * @param context 段落函数所需的运行期上下文。
   * @returns 拼装好的 system prompt 字符串。
   */
  assembleSystemPrompt(context: PromptContext): string {
    if (this.enableCache) {
      const key = this.computeCacheKey(context, 'full');
      const cached = this.cache.get(key);
      if (cached !== undefined) {
        return cached;
      }
      const prompt = this.renderFull(context);
      this.storeInCache(key, prompt);
      return prompt;
    }
    return this.renderFull(context);
  }

  /**
   * 仅返回静态前缀（包含末尾的 {@link DYNAMIC_BOUNDARY}）。
   *
   * 用于上层提前发起 prompt cache warm-up：
   * 即便后续动态段落变化，前缀依然命中缓存。
   */
  getStaticPrefix(context: PromptContext): string {
    if (this.enableCache) {
      const key = this.computeCacheKey(context, 'prefix');
      const cached = this.cache.get(key);
      if (cached !== undefined) {
        return cached;
      }
      const prefix = this.renderStaticPrefix(context);
      this.storeInCache(key, prefix);
      return prefix;
    }
    return this.renderStaticPrefix(context);
  }

  /**
   * 主动清除全部缓存。
   *
   * 当外部依赖（如可用工具集合、规则集）发生变化但 context 字段未变时，
   * 调用方应显式调用本方法以避免命中过期缓存。
   */
  invalidateCache(): void {
    this.cache.clear();
  }

  /**
   * 测量各语义分段的字符数，用于上下文窗口 breakdown 的 token 估算。
   *
   * 不触发缓存；调用时需保证 context 与 assembleSystemPrompt 所用的 context 一致。
   */
  measureSections(context: PromptContext): PromptSectionMetrics {
    const rulesText   = sectionRules(context)  ?? '';
    const memoryText  = sectionMemory(context) ?? '';
    const fullPrompt  = this.assembleSystemPrompt(context);
    const dynamicChars = rulesText.length + memoryText.length;
    return {
      system_prompt: Math.max(0, fullPrompt.length - dynamicChars),
      rules:         rulesText.length,
      memory_files:  memoryText.length,
    };
  }

  /** 渲染完整 prompt（不使用缓存）。 */
  private renderFull(context: PromptContext): string {
    const groups = this.collectGroups(context);
    const staticParts = [...groups.staticParts];
    staticParts.push(LOOP_OUTPUT_GUIDANCE);
    const parts: string[] = [];
    if (staticParts.length > 0) {
      parts.push(staticParts.join('\n\n'));
    }
    if (groups.dynamicParts.length > 0) {
      // DYNAMIC_BOUNDARY 自带前后换行，不再额外补充 \n\n。
      const dynamic = groups.dynamicParts.join('\n\n');
      if (parts.length > 0) {
        return parts[0] + DYNAMIC_BOUNDARY + dynamic;
      }
      return dynamic;
    }
    return parts.join('');
  }

  /** 渲染静态前缀（不使用缓存），始终以 {@link DYNAMIC_BOUNDARY} 结尾。 */
  private renderStaticPrefix(context: PromptContext): string {
    const groups = this.collectGroups(context);
    const staticText = [...groups.staticParts, LOOP_OUTPUT_GUIDANCE].join('\n\n');
    return staticText + DYNAMIC_BOUNDARY;
  }

  /** 调用所有段落函数并按静态/动态分组，跳过返回 null 或空白的段落。 */
  private collectGroups(context: PromptContext): SectionGroups {
    const staticParts: string[] = [];
    const dynamicParts: string[] = [];

    for (let i = 0; i < this.sections.length; i += 1) {
      const section = this.sections[i];
      const text = section(context);
      if (text === null || text === undefined) {
        continue;
      }
      const trimmed = text.trim();
      if (trimmed.length === 0) {
        continue;
      }
      if (i < this.staticSectionCount) {
        staticParts.push(trimmed);
      } else {
        dynamicParts.push(trimmed);
      }
    }

    return { staticParts, dynamicParts };
  }

  /** 计算缓存 key：context 序列化后的 SHA-256，附带类型后缀。 */
  private computeCacheKey(
    context: PromptContext,
    kind: 'full' | 'prefix',
  ): string {
    const serialized = JSON.stringify(context, replacerForStableKeys);
    const hash = createHash('sha256')
      .update(serialized ?? '')
      .digest('hex');
    return `${kind}:${hash}`;
  }

  /** 写入缓存，超出上限时按插入序淘汰最旧条目。 */
  private storeInCache(key: string, value: string): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    this.cache.set(key, value);
    while (this.cache.size > MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next();
      if (oldest.done) {
        break;
      }
      this.cache.delete(oldest.value);
    }
  }
}

/**
 * `JSON.stringify` 的 replacer：对对象键做稳定排序，
 * 保证不同插入顺序但内容相同的 context 命中同一缓存。
 */
function replacerForStableKeys(_key: string, value: unknown): unknown {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(record).sort()) {
      sorted[k] = record[k];
    }
    return sorted;
  }
  return value;
}
