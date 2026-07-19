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
    // web_fetch 结果：保留 URL / Status 头，正文省略
    this.rules.push({
      match: (name, r) => name === 'web_fetch' && !!firstText(r),
      summarize: (_name, r) => {
        const text = firstText(r) ?? '';
        const head = text
          .split('\n')
          .filter((line) => line.startsWith('URL:') || line.startsWith('Status:'))
          .slice(0, 2)
          .join(' | ');
        return `[web_fetch] ${head || text.slice(0, 100)} — ${text.length} chars body omitted (truncated summary)`;
      },
    });
    // web_search 结果：保留 query/provider/results 头 + 前 3 条标题与 URL
    this.rules.push({
      match: (name, r) => name === 'web_search' && !!firstText(r),
      summarize: (_name, r) => {
        const lines = (firstText(r) ?? '').split('\n');
        const header = lines
          .filter((line) => /^(Search query|Provider|Results):/.test(line))
          .join(' | ');
        const entries: string[] = [];
        for (let i = 0; i < lines.length && entries.length < 6; i++) {
          if (/^\d+\.\s/.test(lines[i])) {
            entries.push(lines[i].trim().slice(0, 120));
            const url = lines[i + 1]?.trim();
            if (url) entries.push(url.slice(0, 160));
          }
        }
        return `[web_search] ${header}\n${entries.slice(0, 6).join('\n')}\n(truncated summary)`;
      },
    });
    // git 族结果：保留首行 + 总行数（diff/log 正文省略）
    this.rules.push({
      match: (name, r) => name.startsWith('git_') && !!firstText(r),
      summarize: (name, r) => {
        const text = firstText(r) ?? '';
        const lines = text.split('\n');
        return `[${name}] ${lines[0].slice(0, 100)} — ${lines.length} lines (truncated summary)`;
      },
    });
    // edit 族结果（edit_file / write_file）：保留首行（路径与字节 delta 已在首行内）
    this.rules.push({
      match: (name, r) => (name === 'edit_file' || name === 'write_file') && !!firstText(r),
      summarize: (name, r) => {
        const firstLine = (firstText(r) ?? '').split('\n')[0];
        return `[${name}] ${firstLine.slice(0, 160)} (truncated summary)`;
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
