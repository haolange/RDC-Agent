/**
 * BashAstAnalyzer — shell command risk classifier (NOT a security boundary).
 *
 * Parses command structure (pipelines / chaining / path-prefixed binaries) and
 * scores risk. Optional tree-sitter-bash is used when installed; otherwise the
 * structural tokenizer + pattern rules apply. OS ACL / sandbox / hard-deny lists
 * remain the actual enforcement layers.
 */
export interface BashAnalysisResult {
  safe: boolean;
  risk: 'none' | 'low' | 'medium' | 'high' | 'critical';
  reason: string;
  commands: string[];
}

const CRITICAL_PATTERNS = [
  /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\s+(\/|\*|~|\$HOME|%USERPROFILE%)/i,
  /\b(sudo|su)\b/i,
  /\bchmod\s+777\b/i,
  /\bdd\s+if=/i,
  /\bmkfs\b/i,
  /:\(\)\s*\{/,
  />\s*\/dev\/(sd|hd|nvme|xvd)/i,
];

const HIGH_RISK_PATTERNS = [
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bformat\b/i,
  /\bgit\s+push\s+[^\n]*--force\b/i,
  /\beval\b/i,
  /\bbase64\b[^\n]*\|\s*(ba)?sh\b/i,
  /\bcurl\b[^\n]*\|\s*(ba)?sh\b/i,
  /\bwget\b[^\n]*\|\s*(ba)?sh\b/i,
  /\binvoke-expression\b/i,
  /\biex\b/i,
];

const CRITICAL_COMMAND_NAMES = new Set([
  'mkfs',
  'mkfs.ext4',
  'mkfs.ntfs',
  'diskpart',
  'format',
]);

const HIGH_RISK_COMMAND_NAMES = new Set([
  'shutdown',
  'reboot',
  'sudo',
  'su',
  'dd',
  'cipher',
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Split on top-level shell separators while keeping simple pipelines/chains. */
export function splitShellSegments(command: string): string[] {
  return command
    .split(/(?:&&|\|\||[;&\n]|\|(?!\|))/g)
    .map((segment) => segment.trim())
    .filter(Boolean);
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
 * Word-boundary style prefix match for denied command prefixes.
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

export class BashAstAnalyzer {
  private treeSitterAvailable = false;

  constructor() {
    try {
      require('tree-sitter-bash');
      this.treeSitterAvailable = true;
    } catch {
      /* optional dependency */
    }
  }

  /** Analyze shell command risk. Classifier only — not an enforcement boundary. */
  analyze(command: string): BashAnalysisResult {
    const commands = splitShellSegments(command);

    for (const pattern of CRITICAL_PATTERNS) {
      if (pattern.test(command)) {
        return {
          safe: false,
          risk: 'critical',
          reason: `Matches critical pattern: ${pattern}`,
          commands,
        };
      }
    }

    for (const segment of commands) {
      const basename = extractCommandBasename(segment);
      if (CRITICAL_COMMAND_NAMES.has(basename)) {
        return {
          safe: false,
          risk: 'critical',
          reason: `Critical command token: ${basename}`,
          commands,
        };
      }
    }

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

    if (this.treeSitterAvailable) {
      try {
        return this.astAnalyze(command, commands);
      } catch {
        /* fall through */
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

  private astAnalyze(_command: string, commands: string[]): BashAnalysisResult {
    try {
      // Optional tree-sitter AST parse when dependencies are present.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Parser = require('tree-sitter-bash') as Record<string, unknown>;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const TreeSitter = require('tree-sitter') as Record<string, unknown>;
      const BashCtor = (Parser.default ?? Parser) as { new(): unknown };
      const TsCtor = (TreeSitter.default ?? TreeSitter) as {
        new(): {
          setLanguage: (language: unknown) => void;
          parse: (source: string) => { rootNode: { toString: () => string } };
        };
      };
      const parser = new TsCtor();
      parser.setLanguage(new BashCtor());
      parser.parse(_command);
      return { safe: true, risk: 'low', reason: 'AST parsed successfully', commands };
    } catch {
      return { safe: true, risk: 'low', reason: 'AST analysis skipped (fallback)', commands };
    }
  }
}

export const bashAstAnalyzer = new BashAstAnalyzer();
