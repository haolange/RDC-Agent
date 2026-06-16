import type { AgentToolResult } from '../agent/AgentTool';

/**
 * ToolResultSummarizer — 工具结果规则引擎摘要。
 * 当工具结果过长时，根据规则生成精简摘要，减少上下文占用。
 */
export class ToolResultSummarizer {
  private rules: Array<{
    match: (toolName: string, result: AgentToolResult) => boolean;
    summarize: (toolName: string, result: AgentToolResult) => string;
  }> = [];

  constructor() {
    this.registerDefaultRules();
  }

  private registerDefaultRules(): void {
    const firstText = (r: AgentToolResult): string | undefined => {
      const c = r.content[0];
      return c && c.type === 'text' ? c.text : undefined;
    };
    // grep / glob 结果：只保留数量信息
    this.rules.push({
      match: (name, r) => (name === 'grep' || name === 'glob') && !!firstText(r),
      summarize: (name, r) => {
        const text = firstText(r) ?? '';
        const lines = text.split('\n').filter(Boolean);
        return `[${name}] ${lines.length} matches (truncated summary)`;
      },
    });
    // read_file 结果：只保留行数信息
    this.rules.push({
      match: (name, r) => name === 'read_file' && !!firstText(r),
      summarize: (_name, r) => {
        const text = firstText(r) ?? '';
        const lineCount = text.split('\n').length;
        return `[read_file] ${lineCount} lines (truncated summary)`;
      },
    });
    // bash 结果：只保留退出码和首行
    this.rules.push({
      match: (name, r) => name === 'bash' && !!firstText(r),
      summarize: (name, r) => {
        const firstLine = firstText(r)?.split('\n')[0] ?? '';
        return `[${name}] ${firstLine.slice(0, 80)}...`;
      },
    });
  }

  /**
   * 注册自定义摘要规则。
   */
  addRule(
    match: (toolName: string, result: AgentToolResult) => boolean,
    summarize: (toolName: string, result: AgentToolResult) => string,
  ): void {
    this.rules.push({ match, summarize });
  }

  /**
   * 尝试对工具结果生成摘要。若未匹配规则或结果不长，返回 null。
   */
  trySummarize(toolName: string, result: AgentToolResult, maxChars = 500): string | null {
    const text = result.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');
    if (text.length <= maxChars) return null;
    for (const rule of this.rules) {
      if (rule.match(toolName, result)) {
        return rule.summarize(toolName, result);
      }
    }
    return `[${toolName}] ${text.length} chars (truncated summary)`;
  }
}
