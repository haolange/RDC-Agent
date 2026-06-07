/**
 * AgentTool — 工具的统一抽象基类。
 *
 * 该类把「工具定义 + 执行入口」聚合为一个对象，
 * 供 SkillLoader / MCPManager / 内置工具子系统统一注册。
 *
 * 注意：本类只描述工具自身，调度由上层 ToolExecutor / Agent 完成。
 */

import type {
  ImageContent,
  JsonSchema,
  TextContent,
  ToolDefinition,
} from '../core/types';

/** AgentTool 执行结果（Provider/Runtime 中性表示）。 */
export interface AgentToolResult {
  /** 结果内容块（文本或图像）。 */
  content: (TextContent | ImageContent)[];
  /** 是否为错误结果。 */
  isError: boolean;
}

/** AgentTool 抽象基类。 */
export abstract class AgentTool {
  /** 工具名（在一组 tools 内唯一）。 */
  abstract readonly name: string;
  /** 工具描述（提供给模型阅读）。 */
  abstract readonly description: string;
  /** 入参 JSON Schema。 */
  abstract readonly parameters: JsonSchema;

  /** 执行工具调用。 */
  abstract execute(
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<AgentToolResult>;

  /** 转换为 ToolDefinition（用于发给 LLM）。 */
  toDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      parameters: this.parameters,
    };
  }
}
