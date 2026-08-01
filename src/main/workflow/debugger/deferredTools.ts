/**
 * 工具 deferred loading 的纯划分逻辑（MCP 与 extended builtin 同机制）。
 *
 * - `mcp__{server}__{tool}`（与 MCPManager 前缀规则一致）默认 deferred；
 * - extended tier 的 builtin 工具（BUILTIN_AGENT_TOOL_TIERS）默认 deferred；
 * - core builtin 与未知工具始终注入，顺序稳定（保 tools 指纹前缀）；
 * - 激活的 deferred 工具按激活顺序追加在尾部，减少 prompt cache 失效面。
 */

import { getBuiltinToolTier } from '@shared/constants/agentToolTokens';

/** MCP 工具名前缀，与 MCPManager.buildPrefixedName / isMCPTool 一致。 */
export const MCP_TOOL_NAME_PREFIX = 'mcp__';

/** 判断工具名是否为 MCP 前缀工具。 */
export function isMcpPrefixedToolName(name: string): boolean {
  return name.startsWith(MCP_TOOL_NAME_PREFIX);
}

/** 判断工具是否默认 deferred（mcp__* 或 extended tier builtin）。 */
export function isDeferredToolName(name: string): boolean {
  return isMcpPrefixedToolName(name) || getBuiltinToolTier(name) === 'extended';
}

/** Tasks are a product capability, not a discover-on-demand plugin surface. */
export const TASK_TOOL_NAMES = [
  'task_create',
  'task_update',
  'task_get',
  'task_list',
  'task_stop',
  'output_register',
] as const;

/**
 * Inject every task tool already granted by the effective runtime before the first
 * request. Role and policy filtering happen before this function, so Ask receives
 * only its read-only task surface while Plan/Edit receive their writable surface.
 * The set belongs to DeferredToolActivationTracker, so later tool rounds share it.
 */
export function preactivateTaskTools(
  definitions: readonly { name: string }[],
  activatedNames: Set<string>,
): void {
  const available = new Set(definitions.map((definition) => definition.name));
  for (const name of TASK_TOOL_NAMES) {
    if (available.has(name)) activatedNames.add(name);
  }
}

export interface DeferredToolPartition<T> {
  /** 应注入 LLM 的定义：core 在前（原顺序），激活的 deferred 按激活顺序追加尾部。 */
  injected: T[];
  /** 仍 deferred 的 mcp__* 定义。 */
  deferredMcp: T[];
  /** 仍 deferred 的 extended builtin 定义。 */
  deferredBuiltin: T[];
}

/**
 * 将工具定义划分为「应注入 LLM」与「仍 deferred」两类。
 *
 * @param definitions 策略过滤后的全部可用定义
 * @param activatedNames 已激活的 deferred 工具名集合（Set 迭代序 = 激活顺序）
 */
export function partitionDeferredTools<T extends { name: string }>(
  definitions: readonly T[],
  activatedNames: ReadonlySet<string>,
): DeferredToolPartition<T> {
  const injected: T[] = [];
  const deferredMcp: T[] = [];
  const deferredBuiltin: T[] = [];
  const activatedAvailable = new Map<string, T>();

  for (const def of definitions) {
    if (!isDeferredToolName(def.name)) {
      injected.push(def);
      continue;
    }
    if (activatedNames.has(def.name)) {
      activatedAvailable.set(def.name, def);
    } else if (isMcpPrefixedToolName(def.name)) {
      deferredMcp.push(def);
    } else {
      deferredBuiltin.push(def);
    }
  }

  // 激活工具按激活集合插入顺序追加，保持 core 前缀稳定。
  for (const name of activatedNames) {
    const def = activatedAvailable.get(name);
    if (def) injected.push(def);
  }

  return { injected, deferredMcp, deferredBuiltin };
}

/**
 * 从 tool_search 的 details（ToolSearchPage）提取命中的 deferred 工具名
 * （mcp__* 与 extended builtin）。命中即视为发现/激活候选。
 */
export function extractDeferredToolNamesFromToolSearchDetails(details: unknown): string[] {
  if (!details || typeof details !== 'object') {
    return [];
  }
  const matches = (details as { matches?: unknown }).matches;
  if (!Array.isArray(matches)) {
    return [];
  }
  const names: string[] = [];
  for (const match of matches) {
    if (!match || typeof match !== 'object') continue;
    const name = (match as { name?: unknown }).name;
    if (typeof name === 'string' && isDeferredToolName(name)) {
      names.push(name);
    }
  }
  return names;
}
