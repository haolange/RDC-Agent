/**
 * ShellCommandRiskAnalyzer — command risk classifier (NOT a security boundary).
 *
 * Parses command structure (pipelines / chaining / path-prefixed binaries) and
 * scores risk for approval routing. The highest score is `high`.
 * Catastrophic patterns live only in `shellHardDeny` and are enforced there.
 */

import { splitShellSegments } from '../tools/primitives/shellHardDeny';

export { splitShellSegments };

export interface ShellAnalysisResult {
  safe: boolean;
  risk: 'none' | 'low' | 'medium' | 'high';
  reason: string;
  commands: string[];
}

const HIGH_RISK_PATTERNS = [
  /\bgit\s+push\s+[^\n]*--force\b/i,
  /\beval\b/i,
  /\bbase64\b[^\n]*\|\s*(ba)?sh\b/i,
  /\bcurl\b[^\n]*\|\s*(ba)?sh\b/i,
  /\bwget\b[^\n]*\|\s*(ba)?sh\b/i,
  /\binvoke-expression\b/i,
  /\biex\b/i,
  /\bset-executionpolicy\b/i,
  /\bstop-computer\b/i,
  /\brestart-computer\b/i,
];

const HIGH_RISK_COMMAND_NAMES = new Set([
  'shutdown',
  'reboot',
  'sudo',
  'su',
  'dd',
  'cipher',
  'stop-computer',
  'restart-computer',
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Extract the first command token basename (strip path / quotes). */
export function extractCommandBasename(segment: string): string {
  const trimmed = segment.trim().replace(/^["']|["']$/g, '');
  if (!trimmed) return '';
  const firstToken = trimmed.split(/\s+/)[0]?.replace(/^["']|["']$/g, '') ?? '';
  const base = firstToken.split(/[/\\]/).filter(Boolean).pop() ?? firstToken;
  return base.toLowerCase();
}

/**
 * Word-boundary style prefix match for command prefixes.
 * Matches the prefix as a shell token (start, after separators), not naive startsWith.
 * Also matches path-prefixed binaries (e.g. /bin/rm vs denied prefix "rm").
 */
export function matchesDeniedCommandPrefix(command: string, prefix: string): boolean {
  const needle = prefix.trim().toLowerCase();
  if (!needle) return false;
  const haystack = command.trim().toLowerCase();
  const escaped = escapeRegExp(needle);
  const pattern = new RegExp(`(?:^|[\\s;&|(\`]|\\$\\()${escaped}(?=$|[\\s;&|)])`, 'i');
  if (pattern.test(haystack)) return true;

  const prefixFirst = needle.split(/\s+/)[0] ?? '';
  for (const segment of splitShellSegments(command)) {
    const basename = extractCommandBasename(segment);
    if (!basename) continue;
    const rewritten = segment.trim().replace(/^[^\s]+/, basename).toLowerCase();
    if (new RegExp(`^${escaped}(?=$|[\\s;&|)])`, 'i').test(rewritten)) return true;
    if (basename === prefixFirst && needle === prefixFirst) return true;
  }
  return false;
}

export const matchesCommandPrefix = matchesDeniedCommandPrefix;

export class ShellCommandRiskAnalyzer {
  /** Analyze shell command risk. Classifier only — not an enforcement boundary. */
  analyze(command: string): ShellAnalysisResult {
    const commands = splitShellSegments(command);

    for (const pattern of HIGH_RISK_PATTERNS) {
      if (pattern.test(command)) {
        return {
          safe: false,
          risk: 'high',
          reason: `Matches high-risk pattern: ${pattern}`,
          commands,
        };
      }
    }

    for (const segment of commands) {
      const basename = extractCommandBasename(segment);
      if (HIGH_RISK_COMMAND_NAMES.has(basename)) {
        return {
          safe: false,
          risk: 'high',
          reason: `High-risk command token: ${basename}`,
          commands,
        };
      }
    }

    if (commands.length > 1) {
      return {
        safe: true,
        risk: 'low',
        reason: 'Multi-segment command; no high-risk tokens detected',
        commands,
      };
    }

    return { safe: true, risk: 'none', reason: 'No risky patterns detected', commands };
  }
}

export const shellCommandRiskAnalyzer = new ShellCommandRiskAnalyzer();
