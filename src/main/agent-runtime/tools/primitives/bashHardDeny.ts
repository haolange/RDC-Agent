/**
 * Catastrophic shell patterns that are hard-denied in every permission mode,
 * including full-access. Shared by AgentPermissionPolicy and BashDenyListRule.
 */

const DENY_PATTERNS: string[] = [
  'rm -rf /',
  'rm -rf /*',
  'sudo ',
  'shutdown',
  'reboot',
  'mkfs',
  'dd if=',
  '> /dev/',
  'chmod 777',
  'format c:',
  'format /q',
  ':(){ :|:& };:',
];

/** Returns the matched deny pattern, or null when the command is not hard-denied. */
export function matchBashHardDeny(command: string): string | null {
  const lowered = String(command ?? '').toLowerCase();
  for (const pattern of DENY_PATTERNS) {
    if (lowered.includes(pattern.toLowerCase())) {
      return pattern;
    }
  }
  return null;
}

export function listBashHardDenyPatterns(): readonly string[] {
  return DENY_PATTERNS;
}
