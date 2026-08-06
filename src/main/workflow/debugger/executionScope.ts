/**
 * Execution scope ids for turns/slots without a durable session.
 * Never use __anon__ / __no_session__ placeholders.
 */

import { randomUUID } from 'crypto';

export function createEphemeralScopeId(): string {
  return `ephemeral:${randomUUID()}`;
}

export function resolveExecutionScopeId(
  sessionId?: string | null,
  ephemeralScopeId?: string | null,
): string {
  const sid = sessionId?.trim();
  if (sid) return sid;
  const epi = ephemeralScopeId?.trim();
  if (epi) return epi;
  return createEphemeralScopeId();
}

export function requireExecutionScopeId(scopeId: string | null | undefined): string {
  const value = scopeId?.trim();
  if (!value) {
    throw new Error('EXECUTION_SCOPE_REQUIRED: a non-empty session or ephemeral scope id is required.');
  }
  return value;
}
