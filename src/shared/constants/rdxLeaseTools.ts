/**
 * Tool ids that read or drive Live RDC / parent RDX context.
 * Offline children (requiresRdxLease=false) must lose these at allowlist compile time.
 * `rdx_probe` is reserved even before the tool is registered.
 */

export const RDX_LEASE_TOOL_IDS = ['rdx_context', 'rdx_probe'] as const;

const RDX_LEASE_TOOL_ID_SET = new Set<string>(RDX_LEASE_TOOL_IDS);

const RDX_LEASE_TOKEN_ALIASES = new Set([
  ...RDX_LEASE_TOOL_IDS,
  'rdx',
  'rdxContext',
  'rdxProbe',
]);

export function isRdxLeaseToolName(toolName: string): boolean {
  const normalized = toolName.trim();
  if (!normalized) return false;
  return RDX_LEASE_TOKEN_ALIASES.has(normalized) || RDX_LEASE_TOOL_ID_SET.has(normalized);
}

/** Drop RDX lease tools and their manifest aliases. Leaves `shell` intact. */
export function stripRdxLeaseToolsFromAllowlist(allowlist: readonly string[]): string[] {
  return allowlist.filter((entry) => !isRdxLeaseToolName(entry));
}
