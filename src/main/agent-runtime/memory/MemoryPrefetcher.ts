/**
 * MemoryPrefetcher — 相关记忆预取。
 *
 * 在 Agent 启动时异步加载与当前上下文相关的记忆，
 * 提升首次交互时的响应质量。
 */
import type { MemoryStore } from './MemoryStore';

export class MemoryPrefetcher {
  private prefetchPromise: Promise<void> | null = null;
  private prefetched: string[] = [];

  constructor(private store: MemoryStore) {}

  /** 启动预取（不阻塞）。 */
  startPrefetch(context: { sessionTitle?: string; projectId?: string }): void {
    this.prefetchPromise = (async () => {
      try {
        const all = await this.store.listMemories();
        const keywords = [
          context.sessionTitle?.toLowerCase() ?? '',
          context.projectId?.toLowerCase() ?? '',
        ].filter(Boolean);

        for (const mem of all) {
          const text = (mem.content + mem.description).toLowerCase();
          if (keywords.some((kw) => text.includes(kw))) {
            this.prefetched.push(mem.name);
          }
        }
      } catch { /* pre-fetch failure is non-blocking */ }
    })();
  }

  /** 等待预取完成并获取相关记忆 slug 列表。 */
  async getRelevantSlugs(): Promise<string[]> {
    if (this.prefetchPromise) {
      try { await this.prefetchPromise; } catch { /* ignore */ }
    }
    return [...this.prefetched];
  }
}
