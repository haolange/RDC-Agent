/**
 * Canonical agent tool tokens and builtin tool ids.
 * Single source of truth for seed manifests, allowlist expansion, and Settings diagnostics.
 */

/** All builtin AgentTool ids after search_codebase removal (36). */
export const BUILTIN_AGENT_TOOL_IDS = [
  'bash',
  'read_file',
  'write_file',
  'edit_file',
  'glob',
  'grep',
  'git_status',
  'git_diff',
  'git_log',
  'git_add',
  'git_unstage',
  'git_commit',
  'web_fetch',
  'web_search',
  'delete_file',
  'move_file',
  'copy_file',
  'notebook_edit',
  'task_create',
  'task_update',
  'task_get',
  'task_list',
  'task_stop',
  'ask_user',
  'agent_handoff',
  'memory_search',
  'memory_read',
  'memory_write',
  'memory_delete',
  'plan_artifact',
  'skills',
  'skill_read',
  'mcp',
  'subagent',
  'rdx_context',
  'tool_search',
] as const;

export type BuiltinAgentToolId = (typeof BUILTIN_AGENT_TOOL_IDS)[number];

export const BUILTIN_AGENT_TOOL_ID_SET = new Set<string>(BUILTIN_AGENT_TOOL_IDS);

/**
 * 工具面分层：core 每请求常驻注入 schema；extended 走 deferred 机制，
 * 由 tool_search 发现或直接调用 fail-open 激活后再注入（与 mcp__* 同机制）。
 */
export type BuiltinAgentToolTier = 'core' | 'extended';

export const BUILTIN_AGENT_TOOL_TIERS: Record<BuiltinAgentToolId, BuiltinAgentToolTier> = {
  bash: 'core',
  read_file: 'core',
  write_file: 'core',
  edit_file: 'core',
  glob: 'core',
  grep: 'core',
  git_status: 'core',
  git_diff: 'core',
  git_log: 'core',
  git_add: 'extended',
  git_unstage: 'extended',
  git_commit: 'extended',
  web_fetch: 'core',
  web_search: 'core',
  delete_file: 'extended',
  move_file: 'extended',
  copy_file: 'extended',
  notebook_edit: 'extended',
  task_create: 'extended',
  task_update: 'extended',
  task_get: 'extended',
  task_list: 'extended',
  task_stop: 'extended',
  ask_user: 'core',
  agent_handoff: 'extended',
  memory_search: 'extended',
  memory_read: 'extended',
  memory_write: 'extended',
  memory_delete: 'extended',
  plan_artifact: 'extended',
  skills: 'extended',
  skill_read: 'extended',
  mcp: 'extended',
  subagent: 'extended',
  rdx_context: 'core',
  tool_search: 'core',
};

export function getBuiltinToolTier(toolName: string): BuiltinAgentToolTier | null {
  return BUILTIN_AGENT_TOOL_ID_SET.has(toolName)
    ? BUILTIN_AGENT_TOOL_TIERS[toolName as BuiltinAgentToolId]
    : null;
}

/** Manifest-facing canonical tokens → concrete tool ids. */
export const CANONICAL_TOOL_TOKEN_EXPANSIONS: Record<string, string[]> = {
  read: ['read_file'],
  search: ['glob', 'grep'],
  web: ['web_fetch', 'web_search'],
  git: ['git_status', 'git_diff', 'git_log', 'git_add', 'git_unstage', 'git_commit'],
  bash: ['bash'],
  write: ['write_file'],
  edit: ['edit_file'],
  askUser: ['ask_user'],
  'vscode/askQuestions': ['ask_user'],
  agent: ['agent_handoff'],
  handoff: ['agent_handoff'],
  task: ['task_create', 'task_update', 'task_get', 'task_list', 'task_stop'],
  memory: ['memory_search', 'memory_read'],
  'memory-write': ['memory_write', 'memory_delete'],
  'file-manage': ['delete_file', 'move_file', 'copy_file', 'notebook_edit'],
  planArtifact: ['plan_artifact'],
  artifact: ['plan_artifact'],
  'vscode/memory': ['memory_read'],
  skill: ['skills', 'skill_read'],
  skills: ['skills', 'skill_read'],
  mcp: ['mcp', 'mcp__*'],
  MCP: ['mcp', 'mcp__*'],
  tool_search: ['tool_search'],
  rdxContext: ['rdx_context'],
  rdx: ['rdx_context'],
  subagent: ['subagent'],
};

/** Tokens intentionally rejected (removed or renamed). No silent fallback. */
export const REJECTED_TOOL_TOKENS: Record<string, string> = {
  todo: 'Use canonical token "task" instead of removed token "todo".',
  search_codebase: 'Tool "search_codebase" was removed; use glob/grep.',
};

export interface ToolTokenDiagnostic {
  token: string;
  message: string;
}

export function expandCanonicalToolToken(toolName: string): string[] {
  return CANONICAL_TOOL_TOKEN_EXPANSIONS[toolName] ?? [toolName];
}

/**
 * Diagnose manifest tool tokens that cannot expand to runtime tools.
 * Fail-visible: unknown/removed tokens are reported, never silently ignored.
 */
export function diagnoseManifestToolTokens(tokens: string[]): ToolTokenDiagnostic[] {
  const diagnostics: ToolTokenDiagnostic[] = [];
  for (const raw of tokens) {
    const token = raw.trim();
    if (!token) continue;
    if (REJECTED_TOOL_TOKENS[token]) {
      diagnostics.push({ token, message: REJECTED_TOOL_TOKENS[token] });
      continue;
    }
    if (CANONICAL_TOOL_TOKEN_EXPANSIONS[token]) continue;
    if (BUILTIN_AGENT_TOOL_ID_SET.has(token) || token.startsWith('mcp__') || token.endsWith('*')) {
      continue;
    }
    diagnostics.push({
      token,
      message: `Unknown tool token "${token}". Use a canonical token (e.g. read, search, task, git) or a concrete tool id.`,
    });
  }
  return diagnostics;
}
