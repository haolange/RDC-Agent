import type { AgentRole } from '@shared/types/agent';

export const ASK_READONLY_TOOL_ALLOWLIST = [
  'primitive.read',
  'primitive.glob',
  'primitive.grep',
  'primitive.webFetch',
  'primitive.webSearch',
  'primitive.askUser',
  'primitive.task.list',
  'task.readonly',
];

const ASK_DENIED_TOOL_PATTERNS = [
  'primitive.bash',
  'primitive.write',
  'primitive.edit',
  'primitive.remove',
  'bash.exec',
  'fs.write',
  'fs.edit',
  'fs.remove',
];

export function toolMatchesRuntimePolicy(toolName: string, allowlist: string[] = []): boolean {
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

export function resolveRuntimeToolAllowlist(agentId: AgentRole, allowlist: string[] = []): string[] {
  if (agentId === 'ask_agent') {
    return ASK_READONLY_TOOL_ALLOWLIST;
  }
  return Array.from(new Set(allowlist.filter(Boolean)));
}

export function isRuntimeToolAllowed(toolName: string, agentId: AgentRole, allowlist: string[] = []): boolean {
  if (agentId === 'ask_agent' && ASK_DENIED_TOOL_PATTERNS.some((pattern) => toolName === pattern || toolName.startsWith(`${pattern}.`))) {
    return false;
  }
  return toolMatchesRuntimePolicy(toolName, resolveRuntimeToolAllowlist(agentId, allowlist));
}

export function createRuntimePolicyDeniedResult(toolName: string, agentId: AgentRole) {
  return {
    ok: false,
    data: {},
    artifacts: [],
    error: {
      code: 'AGENT_RUNTIME_TOOL_DENIED',
      message: `Tool ${toolName} is not allowed for ${agentId}.`,
      category: 'policy',
    },
    duration_ms: 0,
  };
}
