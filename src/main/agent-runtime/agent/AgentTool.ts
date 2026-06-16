import type {
  ImageContent,
  JsonSchema,
  TextContent,
  ToolDefinition,
} from '../core/types';

export type AgentToolPermissionHint = 'readonly' | 'session_mutation' | 'mutation' | 'destructive';

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
  ): Promise<AgentToolResult<TDetails>>;
}

export function toolToDefinition(tool: Pick<AgentTool, 'name' | 'description' | 'parameters'>): ToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  };
}
