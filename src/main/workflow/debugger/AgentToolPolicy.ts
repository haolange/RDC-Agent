import type { ToolCallResult, ToolDefinition, ToolParameter } from '@shared/types/tool';

export interface PreparedAgentTool {
  originalName: string;
  sdkName: string;
  definition: ToolDefinition;
  parameters: Record<string, unknown>;
}

function parameterSchema(parameter: ToolParameter): Record<string, unknown> {
  if (parameter.enum?.length) {
    return {
      type: 'string',
      enum: parameter.enum,
      description: parameter.description,
    };
  }

  if (parameter.type === 'array') {
    return {
      type: 'array',
      items: {},
      description: parameter.description,
    };
  }

  if (parameter.type === 'object') {
    return {
      type: 'object',
      additionalProperties: true,
      description: parameter.description,
    };
  }

  return {
    type: parameter.type,
    description: parameter.description,
  };
}

export function buildToolJsonSchema(tool: ToolDefinition): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const parameter of tool.parameters ?? []) {
    properties[parameter.name] = parameterSchema(parameter);
    if (parameter.required) {
      required.push(parameter.name);
    }
  }

  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}

export function buildToolZodRawShape(tool: ToolDefinition): Record<string, unknown> {
  const shape: Record<string, unknown> = {};
  for (const parameter of tool.parameters ?? []) {
    shape[parameter.name] = parameter;
  }
  return shape;
}

export function toolMatchesPolicy(toolName: string, allowlist?: string[]): boolean {
  if (!allowlist || allowlist.length === 0) {
    return false;
  }

  for (const pattern of allowlist) {
    if (pattern === '*' || pattern === toolName) {
      return true;
    }
    if (pattern.endsWith('.*') && toolName.startsWith(pattern.slice(0, -1))) {
      return true;
    }
  }

  return false;
}

export function sanitizeSdkToolName(toolName: string): string {
  const sanitized = toolName.replace(/[^a-zA-Z0-9_]/g, '_');
  return /^[a-zA-Z_]/.test(sanitized) ? sanitized : `rdc_${sanitized}`;
}

export function prepareAgentTools(tools: ToolDefinition[], allowlist?: string[]): PreparedAgentTool[] {
  const used = new Set<string>();
  const prepared: PreparedAgentTool[] = [];

  for (const definition of tools) {
    if (!toolMatchesPolicy(definition.name, allowlist)) {
      continue;
    }

    const baseName = sanitizeSdkToolName(definition.name);
    let sdkName = baseName;
    let index = 2;
    while (used.has(sdkName)) {
      sdkName = `${baseName}_${index}`;
      index += 1;
    }
    used.add(sdkName);

    prepared.push({
      originalName: definition.name,
      sdkName,
      definition,
      parameters: buildToolJsonSchema(definition),
    });
  }

  return prepared;
}

export function formatToolResult(result: ToolCallResult): string {
  return JSON.stringify({
    ok: result.ok,
    data: result.data,
    error: result.error,
    artifacts: result.artifacts,
    duration_ms: result.duration_ms,
    trace_id: result.trace_id,
  });
}
