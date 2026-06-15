import type { AgentTool } from '../agent/AgentTool';

/**
 * ToolPool — 工具实例缓存池。
 * 避免重复创建有状态的工具（如数据库连接、API 客户端）。
 */
export class ToolPool {
  private pool = new Map<string, AgentTool>();

  register(tool: AgentTool): void {
    this.pool.set(tool.name, tool);
  }

  get(name: string): AgentTool | undefined {
    return this.pool.get(name);
  }

  has(name: string): boolean {
    return this.pool.has(name);
  }

  all(): AgentTool[] {
    return Array.from(this.pool.values());
  }

  allNames(): string[] {
    return Array.from(this.pool.keys());
  }

  allMeta(): Pick<AgentTool, 'name' | 'description' | 'spec'>[] {
    return this.all().map((t) => ({ name: t.name, description: t.description, spec: t.spec }));
  }

  clear(): void {
    this.pool.clear();
  }
}
