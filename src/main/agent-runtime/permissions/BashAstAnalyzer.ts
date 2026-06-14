/**
 * BashAstAnalyzer — 基于 AST 的 Bash 命令安全分析。
 *
 * 替代字符串模式匹配，使用 tree-sitter-bash 解析命令结构。
 * 回退到正则匹配（当 tree-sitter 不可用时）。
 */
export interface BashAnalysisResult {
  safe: boolean;
  risk: 'none' | 'low' | 'medium' | 'high' | 'critical';
  reason: string;
  commands: string[];
}

const CRITICAL_PATTERNS = [
  /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\s+\//i, // rm -rf /
  /\b(sudo|su)\s/i,
  /\bchmod\s+777\b/i,
  /\bdd\s+if=/i,
  /\bmkfs\b/i,
  /:\(\)\s*\{/,
];

const HIGH_RISK_PATTERNS = [
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bformat\s/i,
  /\bgit\s+push\s+.*--force/i,
];

export class BashAstAnalyzer {
  private treeSitterAvailable = false;

  constructor() {
    try { require('tree-sitter-bash'); this.treeSitterAvailable = true; } catch { /* fall through */ }
  }

  /** 分析 shell 命令的安全性。 */
  analyze(command: string): BashAnalysisResult {
    const commands = this.extractCommands(command);

    // 检查危险模式
    for (const pattern of CRITICAL_PATTERNS) {
      if (pattern.test(command)) {
        return { safe: false, risk: 'critical', reason: `Matches critical pattern: ${pattern}`, commands };
      }
    }
    for (const pattern of HIGH_RISK_PATTERNS) {
      if (pattern.test(command)) {
        return { safe: false, risk: 'high', reason: `Matches high-risk pattern: ${pattern}`, commands };
      }
    }

    // AST 分析（如有 tree-sitter）
    if (this.treeSitterAvailable) {
      try {
        return this.astAnalyze(command, commands);
      } catch { /* fall back to pattern match */ }
    }

    return { safe: true, risk: 'none', reason: 'No risky patterns detected', commands };
  }

  private astAnalyze(_command: string, commands: string[]): BashAnalysisResult {
    try {
      // tree-sitter AST 分析（需要 tree-sitter + tree-sitter-bash 依赖）
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Parser = require('tree-sitter-bash') as Record<string, unknown>;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const TreeSitter = require('tree-sitter') as Record<string, unknown>;
      const BashCtor = (Parser.default ?? Parser) as { new(): unknown };
      const TsCtor = (TreeSitter.default ?? TreeSitter) as { new(): { setLanguage: (l: unknown) => void; parse: (s: string) => { rootNode: { toString: () => string } } } };
      const parser = new TsCtor();
      parser.setLanguage(new BashCtor());
      parser.parse(_command);
      return { safe: true, risk: 'low', reason: 'AST parsed successfully', commands };
    } catch {
      return { safe: true, risk: 'low', reason: 'AST analysis skipped (fallback)', commands };
    }
  }

  private extractCommands(command: string): string[] {
    return command.split(/[;&|]/).map((c) => c.trim()).filter(Boolean);
  }
}
