/**
 * Execution scope identifiers shared by main and renderer.
 *
 * A scope id is exactly one of:
 * - a durable session id;
 * - `ephemeral:<uuid>` for a turn without a durable session;
 * - `<parentScopeId>::subagent::<childId>` for an isolated child execution (nestable).
 *
 * Callers must use these helpers instead of matching the separators directly.
 */

const EPHEMERAL_PREFIX = 'ephemeral:';
const SUBAGENT_SEGMENT = '::subagent::';

export function ephemeralScopeId(uuid: string): string {
  return `${EPHEMERAL_PREFIX}${uuid}`;
}

export function subagentScopeId(parentScopeId: string, childId: string): string {
  return `${childScopePrefix(parentScopeId)}${childId}`;
}

/** Prefix shared by every direct or nested child scope of `parentScopeId`. */
export function childScopePrefix(parentScopeId: string): string {
  return `${parentScopeId}${SUBAGENT_SEGMENT}`;
}

export function isEphemeralScopeId(scopeId: string): boolean {
  return scopeId.trim().startsWith(EPHEMERAL_PREFIX);
}

export function isSubagentScopeId(scopeId: string): boolean {
  return scopeId.includes(SUBAGENT_SEGMENT);
}

/** Execution metadata in these scopes must not outlive the turn that created it. */
export function isTransientScopeId(scopeId: string): boolean {
  return isEphemeralScopeId(scopeId) || isSubagentScopeId(scopeId);
}

/** The outermost scope that owns a (possibly nested) child scope. */
export function rootScopeId(scopeId: string): string {
  return scopeId.split(SUBAGENT_SEGMENT, 1)[0]!;
}
