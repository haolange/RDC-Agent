/**
 * Tool ids that read or drive Live RDC / parent RDC context.
 * Offline children (requiresRdcLease=false) must lose these at allowlist compile time.
 * `rdc_probe` is reserved even before the tool is registered.
 */

export const RDC_LEASE_TOOL_IDS = ['rdc_context', 'rdc_probe'] as const;

const RDC_LEASE_TOOL_ID_SET = new Set<string>(RDC_LEASE_TOOL_IDS);

const RDC_LEASE_TOKEN_ALIASES = new Set([
  ...RDC_LEASE_TOOL_IDS,
  'rdc',
  'rdcContext',
  'rdcProbe',
]);

export function isRdcLeaseToolName(toolName: string): boolean {
  const normalized = toolName.trim();
  if (!normalized) return false;
  return RDC_LEASE_TOKEN_ALIASES.has(normalized) || RDC_LEASE_TOOL_ID_SET.has(normalized);
}

/** Drop RDC lease tools and their manifest aliases. Leaves `shell` intact. */
export function stripRdcLeaseToolsFromAllowlist(allowlist: readonly string[]): string[] {
  return allowlist.filter((entry) => !isRdcLeaseToolName(entry));
}
