/**
 * RDCToolBridge — 把现有的 RDX CLI 工具桥接为 AgentTool。
 *
 * 该模块只定义最小骨架；实际的 CLI 调用由 Task 7 集成时落地。
 * 与 `src/main/tools/ToolBridge.ts`（旧版 RDX bridge）协作：
 *   - 旧 ToolBridge 负责子进程派发与协议层。
 *   - 这里把单个工具描述包装成 AgentTool 接口，供 Agent Runtime 复用。
 *
 * 当前 `initialize()` 仅占位，不会发现任何工具；后续 Task 7 引入真正的发现逻辑。
 */

import type {
  AgentTool,
  AgentToolResult,
} from '../agent/AgentTool';

export interface RDCToolBridgeOptions {
  /** RDX 可执行文件路径（可选；缺省时由旧 ToolBridge 自行解析）。 */
  rdxBinaryPath?: string;
}

export class RDCToolBridge {
  private tools: AgentTool[] = [];
  private initialized = false;

  constructor(private readonly options: RDCToolBridgeOptions = {}) {}

  /** 初始化并发现可用的 RDC 工具。 */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    // 占位实现：真正的发现逻辑由 Task 7 接入旧 ToolBridge 后落地。
    // 这里只是把 options 标记为「已读」，并完成幂等的初始化。
    void this.options.rdxBinaryPath;
    this.tools = [];
    this.initialized = true;
  }

  /** 获取所有已发现的 RDC 工具。 */
  getTools(): AgentTool[] {
    return [...this.tools];
  }

  /** 注入额外工具（用于测试或后续扩展）。 */
  addTool(tool: AgentTool): void {
    this.tools.push(tool);
  }

  /**
   * 后续 Task 7 将由此处实现：
   *   1. 调用旧 ToolBridge 拉取 catalog；
   *   2. 把每个 ToolRegistryEntry 包装成 AgentTool；
   *   3. execute() 内部转发到旧 ToolBridge.callTool。
   *
   * 在那之前，提供一个最小占位的工具构造工具，便于上层联调。
   */
  protected buildPlaceholder(
    name: string,
    label: string,
    description: string,
  ): AgentTool {
    const tool: AgentTool = {
      name,
      label,
      description,
      parameters: { type: 'object', properties: {}, required: [] },
      permissionHint: 'mutation',
      async execute(): Promise<AgentToolResult> {
        return {
          content: [
            {
              type: 'text',
              text: `RDC tool "${name}" is not wired yet (Task 7 will provide the real implementation).`,
            },
          ],
        };
      },
    };
    return tool;
  }
}
