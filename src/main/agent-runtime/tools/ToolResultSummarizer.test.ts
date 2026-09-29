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

  it('keeps native Pixel History binding and factual counters when the payload is offloaded', () => {
    const identity = {
      productSessionId: 'sess-owner', contextId: 'rdc-context',
      replaySessionId: 'sess-replay', captureFileId: 'capf-capture',
    };
    const history = Array.from({ length: 80 }, (_, index) => ({
      event_id: index < 5 ? 12 : 15,
      primitive_id: index,
      passed: index === 7 || index === 9,
      shader_out: { valid: index >= 5, color_rgba: [index / 80, 0, 0, 1] },
      padding: 'x'.repeat(500),
    }));
    const native = {
      result: {
        result_kind: 'rd.texture.get_pixel_history', ok: true,
        data: { resolved_event_id: 15, target_metadata: { texture_id: 'ResourceId::3', x: 7, y: 11 },
          history, binding_truth_level: 'binding_verified', evidence_truth_level: 'structured_readback',
          summary_degraded_reasons: [] },
        meta: { trace_id: 'trc-current' },
      },
      rdcExecutionIdentity: identity,
    };
    const result: AgentToolResult = {
      content: [{ type: 'text', text: JSON.stringify(native) }],
      details: { operation: 'rd.texture.get_pixel_history', exitCode: 0, rdcExecutionIdentity: identity },
    };
    const summary = summarizer.trySummarize('shell', result, 400);
    expect(summary).toContain('session=sess-owner context=rdc-context replay=sess-replay capture=capf-capture');
    expect(summary).toContain('event=15 target=ResourceId::3 pixel=(7,11)');
    expect(summary).toContain('history=80 eventFragments=75 passed=2 shaderValid=75 passedPrimitiveIds=7,9');
    expect(summary).toContain('binding=binding_verified evidence=structured_readback');
    expect(summary).toContain('trace=trc-current');
    expect(summary!.length).toBeLessThan(500);

    const wrongIdentity: AgentToolResult = { ...result, details: {
      operation: 'rd.texture.get_pixel_history', rdcExecutionIdentity: { ...identity, replaySessionId: 'sess-other' },
    } };
    expect(summarizer.trySummarize('shell', wrongIdentity, 400)).toContain('RDC_EXECUTION_IDENTITY_MISMATCH');
  });

  it('keeps the raw disassembly edit plan visible when long ASM is offloaded', () => {
    const identity = {
      productSessionId: 'sess-owner', contextId: 'rdc-context',
      replaySessionId: 'sess-replay', captureFileId: 'capf-capture',
    };
    const native = {
      result: {
        result_kind: 'rd.shader.get_disassembly', ok: true,
        data: {
          disassembly: 'OpFunction\n'.repeat(15000), resolved_event_id: 1248,
          shader_id: 'ResourceId::192587', target: 'SPIR-V ASM', source_encoding: 'spirvasm',
          source_hash: 'a'.repeat(64),
          edit_plan: {
            input_kind: 'text_ir', can_edit_text: true, can_build: true, can_replace: true,
            allowed_edit_inputs: ['source_text', 'diff_text', 'ops'],
            allowed_ops: ['force_full_precision'], blocked_reason: '',
          },
        },
      },
      rdcExecutionIdentity: identity,
    };
    const result: AgentToolResult = {
      content: [{ type: 'text', text: JSON.stringify(native) }],
      details: { operation: 'rd.shader.get_disassembly', exitCode: 0, rdcExecutionIdentity: identity },
    };
    const summary = summarizer.trySummarize('shell', result, 400)!;
    expect(summary).toContain('event=1248 shader=ResourceId::192587 target="SPIR-V ASM" encoding=spirvasm');
    expect(summary).toContain('sourceHash=' + 'a'.repeat(64));
    expect(summary).toContain('"canEditText":true,"canBuild":true,"canReplace":true');
    expect(summary).toContain('"allowedEditInputs":["source_text","diff_text","ops"]');
    expect(summary).not.toContain('OpFunction');
    expect(summary.length).toBeLessThan(700);

    const mismatched: AgentToolResult = { ...result, details: {
      operation: 'rd.shader.get_disassembly', rdcExecutionIdentity: { ...identity, replaySessionId: 'sess-other' },
    } };
    expect(summarizer.trySummarize('shell', mismatched, 400)).toContain('RDC_EXECUTION_IDENTITY_MISMATCH');
    expect(summarizer.trySummarize('shell', mismatched, 400)).not.toContain('canReplace');
  });

  it('keeps ordinary shell summary behavior', () => {
    const summary = summarizer.trySummarize('shell', textResult(`first line\n${'x'.repeat(800)}`), 400);
    expect(summary).toBe('[shell] first line...');
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
