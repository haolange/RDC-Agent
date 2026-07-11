import { describe, expect, it } from 'vitest';
import type { ConversationWorkTrace } from '@shared/types/conversation';
import { buildWorkProcessPresentation } from './workProcessPresentation';

const now = 1_700_000_000_000;

function flattenWorkRows(rows: ReturnType<typeof buildWorkProcessPresentation>['rows']): Array<(typeof rows)[number]> {
  return rows.flatMap((row) => {
    if (row.type === 'section') return [row, ...flattenWorkRows(row.steps)];
    if (row.type === 'toolAggregate') return [row, ...row.children];
    return [row];
  });
}

describe('buildWorkProcessPresentation', () => {
  it('projects streaming commentary even before tools arrive', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'running',
      summary: 'Agent is working',
      updatedAt: now,
      blocks: [
        {
          id: 'runtime-loop-1',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'running',
          result: { text: 'Hello from the assistant', status: 'streaming', toolCallIds: [] },
          toolCalls: [],
          startedAt: now,
        },
      ],
    });

    expect(presentation.rows).toHaveLength(1);
    expect(presentation.rows[0]).toMatchObject({
      type: 'section',
      proseText: 'Hello from the assistant',
      proseStreaming: true,
      thinkingLabel: '',
    });
  });

  it('projects streaming commentary as prose without promoting it into thinking', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'running',
      updatedAt: now,
      blocks: [
        {
          id: 'runtime-loop-prose',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'running',
          result: { text: 'Inspecting capture metadata', status: 'streaming', toolCallIds: [] },
          toolCalls: [],
          startedAt: now,
        },
      ],
    });

    const section = presentation.rows.find((row) => row.type === 'section');
    expect(section).toMatchObject({
      type: 'section',
      proseText: 'Inspecting capture metadata',
      proseStreaming: true,
      thinkingLabel: '',
      thinkingExpandable: false,
    });
  });

  it('uses Thought-for settled labels with duration to the first tool', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now + 1000,
      blocks: [
        {
          id: 'runtime-loop-thought',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { text: 'Read files before answering.', status: 'complete', toolCallIds: ['tool-read'] },
          thinking: {
            text: 'raw chain-of-thought that must not be result text',
            kind: 'raw',
            source: 'openai-compatible-raw',
            visibility: 'raw-collapsed',
            replayPolicy: 'none',
          },
          thinkingStatus: 'complete',
          toolCalls: [
            {
              id: 'tool-read',
              toolName: 'read_file',
              status: 'complete',
              argsPreview: JSON.stringify({ path: 'README.md' }),
              resultPreview: JSON.stringify({ content: 'hello' }),
              startedAt: now + 1500,
              completedAt: now + 1600,
            },
          ],
          startedAt: now,
          completedAt: now + 1600,
        },
      ],
    });

    const section = presentation.rows.find((row) => row.type === 'section');
    expect(section).toMatchObject({
      type: 'section',
      proseText: 'Read files before answering.',
      thinkingLabel: '思考了 1.5s',
      thinkingPreview: 'raw chain-of-thought that must not be result text',
      thinkingExpandable: true,
      thinkingOpenByDefault: false,
    });
  });

  it('uses streaming Thinking label while the loop is active', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'running',
      updatedAt: now,
      blocks: [
        {
          id: 'runtime-loop-stream',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'running',
          result: { text: 'Working…', status: 'streaming', toolCallIds: ['tool-glob'] },
          thinking: {
            text: 'planning next step',
            kind: 'summary',
            source: 'anthropic-thinking',
            visibility: 'summary',
            replayPolicy: 'provider-artifact',
          },
          thinkingStatus: 'streaming',
          toolCalls: [
            {
              id: 'tool-glob',
              toolName: 'glob',
              status: 'running',
              argsPreview: JSON.stringify({ pattern: '**/*' }),
              startedAt: now + 100,
            },
          ],
          startedAt: now,
        },
      ],
    });

    const section = presentation.rows.find((row) => row.type === 'section');
    expect(section).toMatchObject({
      type: 'section',
      thinkingLabel: '正在思考',
      thinkingExpandable: true,
    });
  });

  it('falls back to durationless 已思考 when timestamps are missing', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now,
      blocks: [
        {
          id: 'runtime-loop-no-time',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { text: 'Done.', status: 'complete', toolCallIds: [] },
          thinking: {
            text: 'summary only',
            kind: 'summary',
            source: 'anthropic-thinking',
            visibility: 'summary',
            replayPolicy: 'provider-artifact',
          },
          thinkingStatus: 'complete',
          toolCalls: [],
          startedAt: undefined as unknown as number,
          completedAt: undefined,
        },
      ],
    });

    // Without startedAt the loop may not project duration; if section exists, label must not reuse 思考过程.
    const section = presentation.rows.find((row) => row.type === 'section');
    if (section?.type === 'section' && section.thinkingLabel) {
      expect(section.thinkingLabel).toMatch(/^(已思考|思考了 )/);
      expect(section.thinkingLabel).not.toBe('思考过程');
    }
  });

  it('aggregates three or more consecutive tools into one toolAggregate row', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now,
      blocks: [
        {
          id: 'runtime-loop-explore',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { status: 'complete', toolCallIds: ['tool-read-a', 'tool-read-b', 'tool-glob'] },
          toolCalls: [
            { id: 'tool-read-a', toolName: 'read_file', status: 'complete', argsPreview: JSON.stringify({ path: 'INDEX.md' }), resultPreview: JSON.stringify({ content: 'index' }), startedAt: now, completedAt: now + 10 },
            { id: 'tool-read-b', toolName: 'read_file', status: 'complete', argsPreview: JSON.stringify({ path: 'VERIFICATION.md' }), resultPreview: JSON.stringify({ content: 'verify' }), startedAt: now + 11, completedAt: now + 20 },
            { id: 'tool-glob', toolName: 'glob', status: 'complete', argsPreview: JSON.stringify({ pattern: 'docs/**/*.md' }), resultPreview: JSON.stringify({ matches: ['docs/a.md'] }), startedAt: now + 21, completedAt: now + 30 },
          ],
          startedAt: now,
          completedAt: now + 30,
        },
      ],
    });

    const section = presentation.rows.find((row) => row.type === 'section');
    const visibleSteps = section?.type === 'section' ? section.visibleSteps : [];
    expect(visibleSteps).toHaveLength(1);
    expect(visibleSteps[0]?.type).toBe('toolAggregate');
    expect(visibleSteps[0]?.type === 'toolAggregate' ? visibleSteps[0].children : []).toHaveLength(3);
    expect(section?.type === 'section' ? section.steps : []).toHaveLength(3);
  });

  it('keeps two or fewer tools flat without aggregation', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now,
      blocks: [
        {
          id: 'runtime-loop-two',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { status: 'complete', toolCallIds: ['a', 'b'] },
          toolCalls: [
            { id: 'a', toolName: 'glob', status: 'complete', argsPreview: JSON.stringify({ pattern: '*' }), resultPreview: '{}', startedAt: now, completedAt: now + 5 },
            { id: 'b', toolName: 'read_file', status: 'complete', argsPreview: JSON.stringify({ path: 'a.md' }), resultPreview: '{}', startedAt: now + 6, completedAt: now + 10 },
          ],
          startedAt: now,
          completedAt: now + 10,
        },
      ],
    });

    const section = presentation.rows.find((row) => row.type === 'section');
    const visibleSteps = section?.type === 'section' ? section.visibleSteps : [];
    expect(visibleSteps.map((row) => row.type)).toEqual(['tool', 'tool']);
  });

  it('exposes a human-readable diagnosticCaption for failed tools without JSON envelope', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'error',
      updatedAt: now,
      blocks: [
        {
          id: 'runtime-loop-git-fail',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'error',
          result: { text: 'Checking git root.', status: 'complete', toolCallIds: ['tool-git'] },
          toolCalls: [
            {
              id: 'tool-git',
              toolName: 'bash',
              status: 'error',
              argsPreview: JSON.stringify({ command: 'git rev-parse --show-toplevel' }),
              resultPreview: JSON.stringify({
                ok: false,
                data: {},
                error: {
                  code: 'AGENT_TOOL_FAILED',
                  message: 'fatal: not a git repository (or any of the parent directories): .git',
                },
              }),
              startedAt: now,
              completedAt: now + 20,
            },
          ],
          startedAt: now,
          completedAt: now + 20,
        },
      ],
    });

    const tool = flattenWorkRows(presentation.rows).find((row) => row.type === 'tool');
    expect(tool).toMatchObject({
      type: 'tool',
      status: 'error',
      verb: '执行失败',
      diagnosticCaption: 'fatal: not a git repository (or any of the parent directories): .git',
    });
    expect(tool?.type === 'tool' ? tool.diagnosticCaption : '').not.toMatch(/^\s*\{/);
  });

  it('projects answer-only follow-up loops as response boundaries', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now + 100,
      blocks: [
        {
          id: 'runtime-loop-tools',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { text: 'Inspecting.', status: 'complete', toolCallIds: ['tool-1'] },
          toolCalls: [
            {
              id: 'tool-1',
              toolName: 'glob',
              status: 'complete',
              argsPreview: JSON.stringify({ pattern: '*' }),
              resultPreview: '{}',
              startedAt: now,
              completedAt: now + 10,
            },
          ],
          startedAt: now,
          completedAt: now + 10,
        },
        {
          id: 'runtime-loop-answer',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { text: 'Final answer body', status: 'complete', toolCallIds: [], stopReason: 'end_turn', outputPhase: 'final_answer' },
          toolCalls: [],
          startedAt: now + 20,
          completedAt: now + 40,
        },
      ],
    });

    expect(presentation.rows.some((row) => row.type === 'response')).toBe(true);
    const response = presentation.rows.find((row) => row.type === 'response');
    expect(response).toMatchObject({
      type: 'response',
      title: '回复',
      summary: '回复已生成',
    });
  });

  it('is deterministic for the same trace', () => {
    const trace: ConversationWorkTrace = {
      status: 'complete',
      updatedAt: now,
      blocks: [
        {
          id: 'runtime-loop-stable',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { text: 'Stable.', status: 'complete', toolCallIds: ['t1'] },
          thinking: {
            text: 'think',
            kind: 'summary',
            source: 'anthropic-thinking',
            visibility: 'summary',
            replayPolicy: 'provider-artifact',
          },
          thinkingStatus: 'complete',
          toolCalls: [
            {
              id: 't1',
              toolName: 'glob',
              status: 'complete',
              argsPreview: JSON.stringify({ pattern: '*' }),
              resultPreview: '{}',
              startedAt: now + 200,
              completedAt: now + 220,
            },
          ],
          startedAt: now,
          completedAt: now + 220,
        },
      ],
    };

    expect(buildWorkProcessPresentation(trace)).toEqual(buildWorkProcessPresentation(trace));
  });
});
