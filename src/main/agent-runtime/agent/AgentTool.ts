import type {
  ImageContent,
  JsonSchema,
  TextContent,
  ToolDefinition,
} from '../core/types';

export type AgentToolPermissionHint = 'readonly' | 'mutation' | 'destructive';

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
