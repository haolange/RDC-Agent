/** Shared by prepared prompt facts and the executable provider loop. */
export function resolveAgentMaxTurns(policyMaxTurns?: number, profileMaxTurns?: number | null): number | undefined {
  const profileMax = typeof profileMaxTurns === 'number' && profileMaxTurns > 0 ? profileMaxTurns : undefined;
  if (typeof policyMaxTurns === 'number' && Number.isFinite(policyMaxTurns)) {
    if (policyMaxTurns === 0) {
      throw new Error('POLICY_MAX_TURNS_ZERO: maxTurns must be greater than zero for an executable turn.');
    }
    if (policyMaxTurns > 0 && policyMaxTurns < Number.MAX_SAFE_INTEGER) return Math.min(policyMaxTurns, profileMax ?? Infinity);
  }
  return profileMax;
}
