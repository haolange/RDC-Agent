/**
 * MCP 工具 deferred loading 的纯划分逻辑。
 *
 * 与 MCPManager 前缀规则一致：`mcp__{server}__{tool}`。
 * 非 MCP 工具始终注入；MCP 工具默认 deferred，仅激活后进入 prompt schema。
 */

/** MCP 工具名前缀，与 MCPManager.buildPrefixedName / isMCPTool 一致。 */
export const MCP_TOOL_NAME_PREFIX = 'mcp__';

/** 判断工具名是否为 MCP 前缀工具。 */
export function isMcpPrefixedToolName(name: string): boolean {
  return name.startsWith(MCP_TOOL_NAME_PREFIX);
}

/**
 * 将工具定义划分为「应注入 LLM」与「仍 deferred 的 MCP」。
 *
 * @param definitions 策略过滤后的全部可用定义
 * @param activatedMcpNames 已激活的 mcp__* 工具名集合
 */
export function partitionDeferredMcpTools<T extends { name: string }>(
  definitions: readonly T[],
  activatedMcpNames: ReadonlySet<string>,
): { injected: T[]; deferredMcp: T[] } {
  const injected: T[] = [];
  const deferredMcp: T[] = [];
  for (const def of definitions) {
    if (!isMcpPrefixedToolName(def.name)) {
      injected.push(def);
      continue;
    }
    if (activatedMcpNames.has(def.name)) {
      injected.push(def);
    } else {
      deferredMcp.push(def);
    }
  }
  return { injected, deferredMcp };
}

/**
 * 从 tool_search 的 details（ToolSearchPage）提取命中的 mcp__* 工具名。
 * 命中即视为发现/激活候选。
 */
export function extractMcpToolNamesFromToolSearchDetails(details: unknown): string[] {
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
    if (typeof name === 'string' && isMcpPrefixedToolName(name)) {
      names.push(name);
    }
  }
  return names;
}
