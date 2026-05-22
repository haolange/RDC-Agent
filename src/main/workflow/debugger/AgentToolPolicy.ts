import type { ToolCallResult, ToolDefinition, ToolParameter } from '@shared/types/tool';
import type { AgentRunRequest } from './AgentRunnerPort';

export interface PreparedAgentTool {
  originalName: string;
  sdkName: string;
  definition: ToolDefinition;
  parameters: Record<string, unknown>;
}

interface BuildAgentRunTraceOptions {
  adapter: string;
  request: AgentRunRequest;
  preparedTools: PreparedAgentTool[];
  providerKind?: string;
  policy?: Record<string, unknown>;
  guardrails?: Array<Record<string, unknown>>;
  handoffs?: Array<Record<string, unknown>>;
  sdkTrace?: Record<string, unknown>;
}

const MAX_TRACE_STRING_LENGTH = 512;
const MAX_TRACE_ARRAY_LENGTH = 20;
const MAX_TOOL_RESULT_LENGTH = 8000;
const SECRET_KEY_PATTERN = /(?:api[_-]?key|authorization|secret|token|credential|password)/i;
const SECRET_VALUE_PATTERN = /\b(?:sk|ak|pk|rk|ds|or)-[a-z0-9._-]{8,}\b/gi;

function createLocalTraceId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function redactTraceText(text: string): string {
  const redacted = text.replace(SECRET_VALUE_PATTERN, '[REDACTED_SECRET]');
  return redacted.length > MAX_TRACE_STRING_LENGTH
    ? `${redacted.slice(0, MAX_TRACE_STRING_LENGTH)}...[truncated]`
    : redacted;
}

export function sanitizeTraceValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'string') {
    return redactTraceText(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (depth >= 4) {
    return '[truncated]';
  }
  if (Array.isArray(value)) {
    const entries = value.slice(0, MAX_TRACE_ARRAY_LENGTH).map((entry) => sanitizeTraceValue(entry, depth + 1));
    return value.length > MAX_TRACE_ARRAY_LENGTH
      ? [...entries, { truncatedItems: value.length - MAX_TRACE_ARRAY_LENGTH }]
      : entries;
  }
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SECRET_KEY_PATTERN.test(key)
        ? '[REDACTED_SECRET]'
        : sanitizeTraceValue(entry, depth + 1);
    }
    return output;
  }
  return String(value);
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

export function summarizePreparedTools(tools: PreparedAgentTool[]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    sdkName: tool.sdkName,
    toolName: tool.originalName,
    namespace: tool.definition.namespace,
    group: tool.definition.group,
  }));
}

export function summarizeSdkMessages(messages: Record<string, unknown>[]): Array<Record<string, unknown>> {
  return messages.slice(-MAX_TRACE_ARRAY_LENGTH).map((message) => ({
    type: typeof message.type === 'string' ? message.type : 'unknown',
    subtype: typeof message.subtype === 'string' ? message.subtype : undefined,
    sessionId: typeof message.session_id === 'string' ? redactTraceText(message.session_id) : undefined,
    resultLength: typeof message.result === 'string' ? message.result.length : undefined,
    isError: typeof message.is_error === 'boolean' ? message.is_error : undefined,
    hasMessage: Boolean(message.message),
  }));
}

export function summarizeToolResult(result: ToolCallResult): Record<string, unknown> {
  return {
    ok: result.ok,
    error: result.error
      ? {
          code: result.error.code,
          category: result.error.category,
          message: redactTraceText(result.error.message),
        }
      : undefined,
    dataKeys: result.data ? Object.keys(result.data).slice(0, MAX_TRACE_ARRAY_LENGTH) : [],
    artifactCount: result.artifacts?.length ?? 0,
    duration_ms: result.duration_ms,
    trace_id: result.trace_id,
  };
}

export function createToolPolicyDeniedResult(toolName: string, reason: string): ToolCallResult {
  return {
    ok: false,
    error: {
      code: 'TOOL_DENIED_BY_RDC_POLICY',
      category: 'policy',
      message: reason,
      details: {
        toolName,
      },
    },
    artifacts: [],
    duration_ms: 0,
    trace_id: createLocalTraceId('agent-tool-denied'),
  };
}

export function buildAgentRunTrace(options: BuildAgentRunTraceOptions): Record<string, unknown> {
  const allowlist = options.request.toolAllowlist ?? [];
  return {
    adapter: options.adapter,
    providerId: options.request.providerId,
    providerKind: options.providerKind ?? null,
    modelId: options.request.modelId,
    agentId: options.request.agentId,
    stage: options.request.stage ?? null,
    runId: options.request.runId ?? null,
    sessionId: options.request.sessionId ?? null,
    turnId: options.request.turnId ?? null,
    tools: summarizePreparedTools(options.preparedTools),
    policy: sanitizeTraceValue({
      executionLayer: 'ToolBridge',
      failClosed: true,
      allowlist,
      allowedToolCount: options.preparedTools.length,
      sandbox: {
        enabled: false,
        reason: 'runtime_ownership_lease_not_configured',
      },
      ...options.policy,
    }),
    guardrails: sanitizeTraceValue(options.guardrails ?? []),
    handoffs: sanitizeTraceValue(options.handoffs ?? []),
    sdkTrace: sanitizeTraceValue(options.sdkTrace ?? {}),
  };
}

export function formatToolResult(result: ToolCallResult): string {
  const payload = sanitizeTraceValue({
    ok: result.ok,
    data: result.data,
    error: result.error,
    artifacts: result.artifacts,
    duration_ms: result.duration_ms,
    trace_id: result.trace_id,
  });
  const formatted = JSON.stringify(payload);
  if (formatted.length <= MAX_TOOL_RESULT_LENGTH) {
    return formatted;
  }
  return JSON.stringify({
    ...summarizeToolResult(result),
    truncated: true,
  });
}
