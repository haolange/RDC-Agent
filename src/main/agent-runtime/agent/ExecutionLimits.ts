/** Shared by prepared prompt facts and the executable provider loop. */
export function resolveAgentMaxTurns(policyMaxTurns?: number, profileMaxTurns?: number | null): number {
  const profileMax = typeof profileMaxTurns === 'number' && profileMaxTurns > 0 ? profileMaxTurns : 25;
  if (typeof policyMaxTurns === 'number' && Number.isFinite(policyMaxTurns)) {
    if (policyMaxTurns === 0) {
      throw new Error('POLICY_MAX_TURNS_ZERO: maxTurns must be greater than zero for an executable turn.');
    }
    if (policyMaxTurns > 0) return Math.min(policyMaxTurns, profileMax);
  }
  return profileMax;
}
