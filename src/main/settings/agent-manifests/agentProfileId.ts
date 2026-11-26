export const SAFE_AGENT_PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;

export function isSafeAgentProfileId(value: string): boolean {
  return SAFE_AGENT_PROFILE_ID_PATTERN.test(value);
}
