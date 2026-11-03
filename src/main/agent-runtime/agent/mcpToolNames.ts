/**
 * Reversible MCP tool names: `mcp__{encode(serverId)}__{encode(toolName)}`.
 * Segments are base64url of UTF-8 so any server/tool identity round-trips.
 */

/** Encode an identity segment for tool names: reversible base64url of utf8. */
export function encodeMcpNameSegment(value: string): string {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

/** Decode a name segment; null when encode(decode(x)) !== x (fail-closed). */
export function decodeMcpNameSegment(encoded: string): string | null {
  try {
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (padded.length % 4)) % 4;
    const decoded = Buffer.from(padded + '='.repeat(padLen), 'base64').toString('utf8');
    if (encodeMcpNameSegment(decoded) !== encoded) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function buildMcpPrefixedName(serverId: string, toolName: string): string {
  return `mcp__${encodeMcpNameSegment(serverId)}__${encodeMcpNameSegment(toolName)}`;
}
