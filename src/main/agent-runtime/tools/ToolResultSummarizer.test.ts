/**
 * ToolResultSummarizer 单元测试 — 覆盖 file/search/shell/web/git/edit 族摘要规则。
 */
import { describe, it, expect } from 'vitest';
import { ToolResultSummarizer } from './ToolResultSummarizer';
import type { AgentToolResult } from '../agent/AgentTool';

const summarizer = new ToolResultSummarizer();

function textResult(text: string): AgentToolResult {
  return { content: [{ type: 'text', text }] };
}

describe('ToolResultSummarizer', () => {
  it('短结果不做摘要', () => {
    expect(summarizer.trySummarize('grep', textResult('one line'), 500)).toBeNull();
  });

  it('grep/glob 只保留匹配数量', () => {
    const text = Array.from({ length: 100 }, (_, i) => `src/file${i}.ts:12: match`).join('\n');
    const summary = summarizer.trySummarize('grep', textResult(text), 500);
    expect(summary).toBe('[grep] 100 matches (truncated summary)');
  });

  it('web_fetch 保留 URL/Status 头并省略正文', () => {
    const text = [
      'URL: https://example.com/docs',
      'Status: 200 OK',
      '',
      'x'.repeat(5000),
    ].join('\n');
    const summary = summarizer.trySummarize('web_fetch', textResult(text), 500);
    expect(summary).toContain('URL: https://example.com/docs');
    expect(summary).toContain('Status: 200 OK');
    expect(summary).toContain('body omitted');
    expect(summary!.length).toBeLessThan(300);
  });

  it('web_search 保留查询头与前几条结果', () => {
    const entries = Array.from({ length: 6 }, (_, i) => [
      `${i + 1}. Result title ${i} ${'pad'.repeat(40)}`,
      `   https://site${i}.example.com/page`,
      `   Snippet text ${'filler '.repeat(30)}`,
    ].join('\n')).join('\n');
    const text = ['Search query: rdc agent', 'Provider: DuckDuckGo HTML', 'Results: 6', '', entries].join('\n');
    const summary = summarizer.trySummarize('web_search', textResult(text), 500);
    expect(summary).toContain('Search query: rdc agent');
    expect(summary).toContain('1. Result title 0');
    expect(summary).toContain('https://site0.example.com/page');
    expect(summary!.length).toBeLessThan(text.length);
  });

  it('git 族保留首行与总行数', () => {
    const text = ['diff --git a/src/a.ts b/src/a.ts', ...Array.from({ length: 400 }, (_, i) => `+line ${i}`)].join('\n');
    const summary = summarizer.trySummarize('git_diff', textResult(text), 500);
    expect(summary).toContain('[git_diff] diff --git a/src/a.ts b/src/a.ts');
    expect(summary).toContain('401 lines');
  });

  it('edit 族保留首行（路径与字节 delta）', () => {
    const firstLine = 'Edited D:/repo/src/app.ts: replaced 1 occurrence (120 → 340 bytes).';
    const text = `${firstLine}\n${'context '.repeat(200)}`;
    const summary = summarizer.trySummarize('edit_file', textResult(text), 500);
    expect(summary).toBe(`[edit_file] ${firstLine} (truncated summary)`);
  });

  it('未匹配规则的长结果回退到通用字符数摘要', () => {
    const text = 'z'.repeat(2000);
    const summary = summarizer.trySummarize('unknown_tool', textResult(text), 500);
    expect(summary).toBe('[unknown_tool] 2000 chars (truncated summary)');
  });
});
