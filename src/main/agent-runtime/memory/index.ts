/**
 * Memory System 子模块统一导出。
 *
 * - {@link MemoryStore}：文件存储 + YAML frontmatter + 索引。
 * - {@link MemoryLoader}：按需加载与上下文相关的记忆。
 * - {@link MemoryExtractor}：从对话中提取新记忆。
 * - {@link MemoryConsolidator}：周期性整理、合并、清理记忆。
 */

export { MemoryStore } from './MemoryStore';
export type { MemoryRecord, WriteMemoryInput } from './MemoryStore';

export { MemoryLoader } from './MemoryLoader';
export type { MemoryLoaderOptions } from './MemoryLoader';

export { MemoryExtractor } from './MemoryExtractor';
export type { MemoryExtractorOptions, ExtractedMemory } from './MemoryExtractor';

export { MemoryConsolidator } from './MemoryConsolidator';
export type { MemoryConsolidatorOptions, ConsolidateResult } from './MemoryConsolidator';
