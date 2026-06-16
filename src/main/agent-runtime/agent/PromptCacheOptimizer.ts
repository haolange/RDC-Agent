import type { ToolDefinition } from '../core/types';

/**
 * PromptCacheOptimizer — Prompt 缓存优化器。
 * 通过静态/动态边界分离和工具稳定排序，提高缓存命中率。
 */
export class PromptCacheOptimizer {
  private staticTools: ToolDefinition[] = [];
  private dynamicTools: ToolDefinition[] = [];

  /**
   * 注册静态工具（很少变化，适合缓存）。
   */
  setStaticTools(tools: ToolDefinition[]): void {
    this.staticTools = this.stableSort(tools);
  }

  /**
   * 注册动态工具（可能变化，放在静态工具之后）。
   */
  setDynamicTools(tools: ToolDefinition[]): void {
    this.dynamicTools = this.stableSort(tools);
  }

  /**
   * 获取优化后的工具列表（静态在前，动态在后，均按名称稳定排序）。
   */
  getOptimizedTools(): ToolDefinition[] {
    return [...this.staticTools, ...this.dynamicTools];
  }

  /**
   * 构建缓存友好的系统提示词前缀。
   * 将静态指令放在前面，动态上下文放在后面。
   */
  buildSystemPrompt(staticInstruction: string, dynamicContext: string): string {
    return `${staticInstruction}\n\n${dynamicContext}`;
  }

  private stableSort(tools: ToolDefinition[]): ToolDefinition[] {
    return [...tools].sort((a, b) => a.name.localeCompare(b.name));
  }
}
