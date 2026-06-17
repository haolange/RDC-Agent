import type {
  ImageContent,
  JsonSchema,
  TextContent,
  ToolDefinition,
} from '../core/types';

export type AgentToolPermissionHint = 'readonly' | 'session_mutation' | 'mutation' | 'destructive';

/**
 * 工具执行上下文：把当前会话的 project root 透传到工具执行层，
 * 使文件/搜索/shell 工具相对「当前激活项目」解析路径，而不是应用 process.cwd()。
 *
 * - `workspaceRoot`：工具 base 解析根（优先取 projectRootPath）。
 * - `projectRootPath`：当前激活项目的根目录，可能为 null（无项目上下文）。
 * - `projectId` / `sessionId`：用于事件/审计关联。
 */
export interface ToolExecutionContext {
  workspaceRoot: string;
  projectRootPath: string | null;
  projectId: string | null;
  sessionId: string | null;
}

export interface AgentToolSpec {
  readonly isReadOnly: boolean;
  readonly isConcurrencySafe: boolean;
  readonly isDestructive: boolean;
  readonly sideEffect?: 'none' | 'process' | 'filesystem' | 'network' | 'session';
  readonly category: 'file' | 'search' | 'system' | 'comm' | 'web' | 'task';
  readonly requiresApproval: boolean;
}

export interface AgentToolResult<TDetails = unknown> {
  content: (TextContent | ImageContent)[];
  isError?: boolean;
  details?: TDetails;
}

export interface AgentTool<
  TParams extends object = Record<string, unknown>,
  TDetails = unknown,
> {
  readonly name: string;
  readonly label?: string;
  readonly description: string;
  readonly parameters: JsonSchema;
  readonly permissionHint?: AgentToolPermissionHint;
  readonly spec?: AgentToolSpec;

  execute(
    toolCallId: string,
    args: TParams,
    signal?: AbortSignal,
    onUpdate?: (partialResult: unknown) => void,
    context?: ToolExecutionContext,
  ): Promise<AgentToolResult<TDetails>>;
}

export function toolToDefinition(tool: Pick<AgentTool, 'name' | 'description' | 'parameters'>): ToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  };
}
