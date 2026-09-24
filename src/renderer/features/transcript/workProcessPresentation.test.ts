import { describe, expect, it } from 'vitest';
import type { ConversationWorkTrace } from '@shared/types/conversation';
import type { ConversationPlanReview } from '@shared/types/planReview';
import { buildWorkProcessPresentation } from './workProcessTracePresentation';
import { createToolRowForPresentation } from './workProcessToolRows';

const now = 1_700_000_000_000;

function flattenWorkRows(rows: ReturnType<typeof buildWorkProcessPresentation>['rows']): Array<(typeof rows)[number]> {
  return rows.flatMap((row) => {
    if (row.type === 'section') return [row, ...flattenWorkRows(row.steps)];
    if (row.type === 'toolAggregate') return [row, ...row.children];
    return [row];
  });
}

describe('buildWorkProcessPresentation', () => {
  it('projects one card per parent subagent tool call without a duplicate tool row', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'running', updatedAt: now + 20,
      blocks: [{
        id: 'loop', kind: 'llm_turn', title: 'LLM turn', status: 'running', startedAt: now,
        result: { status: 'streaming', outputPhase: 'commentary', toolCallIds: ['delegate-1', 'delegate-2'] },
        toolCalls: [
          { id: 'delegate-1', toolName: 'subagent', status: 'complete', startedAt: now,
            delegation: { task: 'Read inputs', profile: 'general', mode: 'wait' } },
          { id: 'delegate-2', toolName: 'subagent', status: 'running', startedAt: now + 1,
            delegation: { task: 'Read config', profile: 'general', mode: 'background', executionId: 'exec-2' } },
        ],
      }],
    });
    const rows = flattenWorkRows(presentation.rows);
    expect(rows.filter((row) => row.type === 'subagent')).toMatchObject([
      { id: 'delegate-1', task: 'Read inputs', status: 'complete' },
      { id: 'delegate-2', task: 'Read config', status: 'running', executionId: 'exec-2' },
    ]);
    expect(rows.filter((row) => row.type === 'tool' && row.toolName === 'subagent')).toHaveLength(0);
  });
  it('withholds runtime context-compaction counters from the human work trace', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'running',
      updatedAt: now,
      blocks: [{
        id: 'compaction-commentary', kind: 'llm_turn', title: 'LLM turn', status: 'complete',
        result: {
          text: 'Context compacted (snip): 79 -> 52 messages, approximately 125287 -> 85642 tokens.',
          status: 'complete', outputPhase: 'commentary', toolCallIds: [],
        },
        toolCalls: [], startedAt: now, completedAt: now + 10,
      }],
    });
    expect(presentation.rows).toHaveLength(0);
  });

  it('keeps both completed checkpoints in the visible history', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now + 20,
      blocks: [
        { id: 'compact-1', kind: 'compaction', title: 'Context compacted', summary: 'old counts', status: 'complete', toolCalls: [], startedAt: now, completedAt: now + 5 },
        { id: 'compact-2', kind: 'compaction', title: 'Context compacted', summary: 'new counts', status: 'complete', toolCalls: [], startedAt: now + 10, completedAt: now + 15 },
      ],
    });
    expect(presentation.rows).toEqual(['compact-1', 'compact-2'].map(id => expect.objectContaining({ id, type: 'summary', text: '上下文已自动压缩' })));
  });

  it('uses authoritative task event rows instead of duplicating task tool receipts', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'running',
      updatedAt: now + 20,
      blocks: [
        {
          id: 'task-create-loop', kind: 'llm_turn', title: 'LLM turn', status: 'complete',
          result: { status: 'complete', outputPhase: 'commentary', toolCallIds: ['task-create'] },
          toolCalls: [{
            id: 'task-create', toolName: 'task_create', status: 'complete',
            argsPreview: JSON.stringify({ tasks: [{ subject: 'Inspect capture' }] }),
            resultPreview: JSON.stringify({ ids: ['task-1'] }),
            startedAt: now, completedAt: now + 10,
          }],
          startedAt: now, completedAt: now + 10,
        },
        {
          id: 'task-snapshot-turn-1', kind: 'task_snapshot', title: '0 of 1 completed', status: 'running',
          taskSnapshot: {
            completed: 0,
            total: 1,
            items: [{ taskId: 'task-1', title: 'Inspect capture', status: 'pending', order: 0 }],
          },
          toolCalls: [], startedAt: now + 10,
        },
      ],
    });
    const rows = flattenWorkRows(presentation.rows);
    expect(rows.filter((row) => row.type === 'tool' && row.toolName === 'task_create')).toHaveLength(0);
    expect(rows.filter((row) => row.type === 'taskSnapshot')).toEqual([
      expect.objectContaining({ id: 'task-snapshot-turn-1', completed: 0, total: 1 }),
    ]);
  });

  it('preserves the TaskRegistry lifecycle state and blocked reason in Work Process', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now + 20,
      blocks: [{
        id: 'task-snapshot-1',
        kind: 'task_snapshot',
        title: '0 of 1 completed',
        status: 'complete',
        taskSnapshot: {
          completed: 0,
          total: 1,
          items: [{ taskId: 'task-1', title: 'Wait for QA', status: 'blocked', statusReason: 'QA waiting', order: 0 }],
        },
        toolCalls: [],
        startedAt: now,
      }],
    });
    const row = flattenWorkRows(presentation.rows).find((entry) => entry.type === 'taskSnapshot');
    expect(row).toEqual(expect.objectContaining({ type: 'taskSnapshot', completed: 0, total: 1 }));
    if (!row || row.type !== 'taskSnapshot') throw new Error('expected task snapshot');
    expect(row.items).toEqual([expect.objectContaining({
      taskId: 'task-1', title: 'Wait for QA', status: 'blocked', statusReason: 'QA waiting', order: 0,
    })]);
  });

  it('withholds unclassified streaming prose before tools arrive', () => {
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

    expect(presentation.rows).toHaveLength(0);
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
          result: {
            text: 'Inspecting capture metadata',
            status: 'streaming',
            toolCallIds: [],
            outputPhase: 'commentary',
          },
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

  it('keeps settled commentary prose even when the loop has no tool calls', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'running',
      updatedAt: now + 2000,
      blocks: [
        {
          id: 'runtime-loop-ask',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: {
            text: 'Need a few answers first.',
            status: 'complete',
            toolCallIds: ['ask-1'],
            stopReason: 'tool_use',
            outputPhase: 'commentary',
          },
          toolCalls: [
            {
              id: 'ask-1',
              toolName: 'ask_user',
              status: 'complete',
              argsPreview: JSON.stringify({ questions: [{ prompt: 'Drink?' }] }),
              resultPreview: JSON.stringify({ answers: [{ answer: '茶' }] }),
              startedAt: now,
              completedAt: now + 500,
            },
          ],
          startedAt: now,
          completedAt: now + 500,
        },
        {
          id: 'runtime-loop-commentary',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: {
            text: 'Thanks — summarizing the parameter combinations next.',
            status: 'complete',
            toolCallIds: [],
            stopReason: 'end_turn',
            outputPhase: 'commentary',
          },
          toolCalls: [],
          startedAt: now + 600,
          completedAt: now + 900,
        },
      ],
    });

    const sections = presentation.rows.filter((row) => row.type === 'section');
    expect(sections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'section',
        proseText: 'Need a few answers first.',
      }),
      expect.objectContaining({
        type: 'section',
        proseText: 'Thanks — summarizing the parameter combinations next.',
      }),
    ]));
  });

  it('does not project settled final_answer text into Work Process prose', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now + 3000,
      blocks: [
        {
          id: 'runtime-loop-process',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: {
            text: 'Checking files.',
            status: 'complete',
            toolCallIds: ['tool-read'],
            stopReason: 'tool_use',
            outputPhase: 'commentary',
          },
          toolCalls: [
            {
              id: 'tool-read',
              toolName: 'read_file',
              status: 'complete',
              argsPreview: JSON.stringify({ path: 'a.ts' }),
              resultPreview: JSON.stringify({ ok: true }),
              startedAt: now + 100,
              completedAt: now + 200,
            },
          ],
          startedAt: now,
          completedAt: now + 200,
        },
        {
          id: 'runtime-loop-final',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: {
            text: 'Final answer body only',
            status: 'complete',
            toolCallIds: [],
            stopReason: 'end_turn',
            outputPhase: 'final_answer',
          },
          toolCalls: [],
          startedAt: now + 300,
          completedAt: now + 400,
        },
      ],
    });

    const finalSection = presentation.rows.find((row) => (
      row.type === 'section' && row.proseText === 'Final answer body only'
    ));
    expect(finalSection).toBeUndefined();
    expect(presentation.rows.some((row) => (
      row.type === 'section' && row.proseText === 'Checking files.'
    ))).toBe(true);
  });

  it('keeps streaming final_answer text out of Work Process prose', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'running',
      updatedAt: now + 3100,
      blocks: [
        {
          id: 'runtime-loop-ask',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: {
            text: 'Need a few answers first.',
            status: 'complete',
            toolCallIds: [],
            stopReason: 'end_turn',
            outputPhase: 'commentary',
          },
          toolCalls: [],
          startedAt: now,
          completedAt: now + 200,
        },
        {
          id: 'runtime-user-input',
          kind: 'user_input',
          title: 'User input requested',
          status: 'complete',
          result: {
            text: '',
            status: 'complete',
            toolCallIds: ['ask-batch'],
          },
          toolCalls: [
            {
              id: 'ask-batch',
              toolName: 'ask_user',
              status: 'complete',
              argsPreview: JSON.stringify({
                questions: [
                  { prompt: 'Drink?' },
                  { prompt: 'Quality?' },
                ],
              }),
              resultPreview: JSON.stringify({
                answers: [{ answer: '茶' }, { answer: '还行' }],
              }),
              startedAt: now + 200,
              completedAt: now + 400,
            },
          ],
          startedAt: now + 200,
          completedAt: now + 400,
        },
        {
          id: 'runtime-loop-final-stream',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'running',
          result: {
            text: 'Streaming final answer tokens after ask_user.',
            status: 'streaming',
            toolCallIds: [],
            outputPhase: 'final_answer',
          },
          toolCalls: [],
          startedAt: now + 500,
        },
      ],
    });

    expect(presentation.rows.some((row) => (
      row.type === 'section'
      && row.proseText === 'Streaming final answer tokens after ask_user.'
    ))).toBe(false);
    expect(presentation.rows.some((row) => (
      row.type === 'section' && row.proseText === 'Need a few answers first.'
    ))).toBe(true);
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
      thinkingLabel: '已思考 · 1.5s',
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
      thinkingOpenByDefault: true,
    });
  });

  it('expands active final-answer thinking by the same lifecycle policy', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'running',
      updatedAt: now,
      blocks: [
        {
          id: 'runtime-loop-final-active',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'running',
          result: {
            text: '',
            status: 'streaming',
            toolCallIds: [],
            stopReason: 'end_turn',
            outputPhase: 'final_answer',
          },
          thinking: {
            text: 'compose a short identity answer',
            kind: 'raw',
            source: 'openai-compatible-raw',
            visibility: 'raw-collapsed',
          },
          thinkingStatus: 'streaming',
          toolCalls: [],
          startedAt: now,
        },
      ],
    });
    expect(presentation.rows.find((row) => row.type === 'section')).toMatchObject({
      thinkingOpenByDefault: true,
      thinkingLabel: '正在思考',
    });
  });

  it('expands active raw thinking and folds settled process-loop thinking by policy', () => {
    const active = buildWorkProcessPresentation({
      status: 'running',
      updatedAt: now,
      blocks: [
        {
          id: 'runtime-loop-raw-open',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'running',
          result: { text: 'Working…', status: 'streaming', toolCallIds: ['tool-glob-raw'] },
          thinking: {
            text: 'live raw thinking',
            kind: 'raw',
            source: 'openai-compatible-raw',
            visibility: 'raw-collapsed',
          },
          thinkingStatus: 'streaming',
          toolCalls: [
            {
              id: 'tool-glob-raw',
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
    expect(active.rows.find((row) => row.type === 'section')).toMatchObject({
      thinkingOpenByDefault: true,
      thinkingLabel: '正在思考',
    });

    const settled = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now + 1000,
      blocks: [
        {
          id: 'runtime-loop-raw-closed',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { text: 'Done.', status: 'complete', toolCallIds: ['tool-glob-raw-done'] },
          thinking: {
            text: 'settled raw thinking',
            kind: 'raw',
            source: 'openai-compatible-raw',
            visibility: 'raw-collapsed',
          },
          thinkingStatus: 'complete',
          toolCalls: [
            {
              id: 'tool-glob-raw-done',
              toolName: 'glob',
              status: 'complete',
              argsPreview: JSON.stringify({ pattern: '**/*' }),
              resultPreview: JSON.stringify({ files: ['a.ts'] }),
              startedAt: now + 100,
              completedAt: now + 200,
            },
          ],
          startedAt: now,
          completedAt: now + 200,
        },
      ],
    });
    expect(settled.rows.find((row) => row.type === 'section')).toMatchObject({
      thinkingOpenByDefault: false,
      thinkingLabel: '已思考 · 100ms',
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
      expect(section.thinkingLabel).toMatch(/^(已思考|已思考 · )/);
      expect(section.thinkingLabel).not.toBe('思考过程');
      expect(section.thinkingLabel).not.toMatch(/思考了|深度思考/);
    }
  });

  it('aggregates eight consecutive tools into one toolAggregate row', () => {
    const toolCallIds = Array.from({ length: 8 }, (_, index) => `tool-read-${index}`);
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now,
      blocks: [
        {
          id: 'runtime-loop-explore',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { status: 'complete', toolCallIds },
          toolCalls: toolCallIds.map((id, index) => ({
            id,
            toolName: 'read_file',
            status: 'complete',
            argsPreview: JSON.stringify({ path: `docs/${index}.md` }),
            resultPreview: JSON.stringify({ content: `document ${index}` }),
            startedAt: now + index * 10,
            completedAt: now + index * 10 + 5,
          })),
          startedAt: now,
          completedAt: now + 30,
        },
      ],
    });

    const section = presentation.rows.find((row) => row.type === 'section');
    const visibleSteps = section?.type === 'section' ? section.visibleSteps : [];
    expect(visibleSteps).toHaveLength(1);
    expect(visibleSteps[0]?.type).toBe('toolAggregate');
    expect(visibleSteps[0]?.type === 'toolAggregate' ? visibleSteps[0].children : []).toHaveLength(8);
    expect(section?.type === 'section' ? section.steps : []).toHaveLength(8);
  });

  it('keeps seven consecutive tools flat without aggregation', () => {
    const toolCallIds = Array.from({ length: 7 }, (_, index) => `tool-flat-${index}`);
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now,
      blocks: [
        {
          id: 'runtime-loop-two',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { status: 'complete', toolCallIds },
          toolCalls: toolCallIds.map((id, index) => ({
            id,
            toolName: 'read_file',
            status: 'complete',
            argsPreview: JSON.stringify({ path: `${index}.md` }),
            resultPreview: '{}',
            startedAt: now + index * 10,
            completedAt: now + index * 10 + 5,
          })),
          startedAt: now,
          completedAt: now + 10,
        },
      ],
    });

    const section = presentation.rows.find((row) => row.type === 'section');
    const visibleSteps = section?.type === 'section' ? section.visibleSteps : [];
    expect(visibleSteps.map((row) => row.type)).toEqual(Array(7).fill('tool'));
  });

  it('projects structured tool evidence and keeps skipped calls visibly distinct', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      toolEvidence: { total: 3, succeeded: 1, failed: 1, skipped: 1 },
      updatedAt: now + 20,
      blocks: [{
        id: 'runtime-loop-evidence',
        kind: 'llm_turn',
        title: 'LLM turn',
        status: 'complete',
        result: { status: 'complete', outputPhase: 'commentary', toolCallIds: ['ok', 'failed', 'skipped'] },
        toolCalls: [
          { id: 'ok', toolName: 'read_file', status: 'complete', startedAt: now, completedAt: now + 1 },
          { id: 'failed', toolName: 'shell', status: 'error', error: 'exit 1', startedAt: now + 2, completedAt: now + 3 },
          { id: 'skipped', toolName: 'web_search', status: 'skipped', startedAt: now + 4, completedAt: now + 5 },
        ],
        startedAt: now,
        completedAt: now + 5,
      }],
    });

    expect(presentation.toolEvidence).toEqual({ total: 3, succeeded: 1, failed: 1, skipped: 1 });
    expect(flattenWorkRows(presentation.rows)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'tool', id: 'failed', status: 'error' }),
      expect.objectContaining({ type: 'tool', id: 'skipped', status: 'skipped', verb: '已跳过' }),
    ]));
  });

  it('preserves info, warning, and error diagnostic severity in Work Process rows', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'error',
      updatedAt: now,
      blocks: [
        {
          id: 'diagnostic-info',
          kind: 'diagnostic',
          title: 'Catalog evidence refreshed',
          status: 'complete',
          diagnosticSeverity: 'info',
          toolCalls: [],
          startedAt: now,
          completedAt: now + 1,
        },
        {
          id: 'diagnostic-warning',
          kind: 'diagnostic',
          title: 'Structured tools are unsupported',
          status: 'complete',
          diagnosticSeverity: 'warning',
          toolCalls: [],
          startedAt: now + 2,
          completedAt: now + 3,
        },
        {
          id: 'diagnostic-error',
          kind: 'diagnostic',
          title: 'Route is unavailable',
          status: 'error',
          diagnosticSeverity: 'error',
          toolCalls: [],
          startedAt: now + 4,
          completedAt: now + 5,
        },
      ],
    });

    expect(presentation.rows.filter((row) => row.type === 'diagnostic')).toEqual([
      expect.objectContaining({ id: 'diagnostic-info', severity: 'info' }),
      expect.objectContaining({ id: 'diagnostic-warning', severity: 'warning' }),
      expect.objectContaining({ id: 'diagnostic-error', severity: 'error' }),
    ]);
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
              toolName: 'shell',
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

  it('folds answer-only follow-up thinking into a quiet section and omits Reply boundaries', () => {
    const withThinking = buildWorkProcessPresentation({
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
          thinking: {
            text: 'Closing thoughts before the reply.',
            kind: 'summary',
            source: 'anthropic-thinking',
            visibility: 'summary',

          },
          thinkingStatus: 'complete',
          toolCalls: [],
          startedAt: now + 20,
          completedAt: now + 40,
        },
      ],
    });

    expect(withThinking.rows.every((row) => row.type !== 'response' as string)).toBe(true);
    const closing = withThinking.rows.filter((row) => row.type === 'section').at(-1);
    expect(closing).toMatchObject({
      type: 'section',
      thinkingPreview: 'Closing thoughts before the reply.',
      thinkingExpandable: true,
      stepCount: 0,
    });

    const withoutThinking = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now + 100,
      blocks: [
        {
          id: 'runtime-loop-tools-2',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { text: 'Inspecting.', status: 'complete', toolCallIds: ['tool-2'] },
          toolCalls: [
            {
              id: 'tool-2',
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
          id: 'runtime-loop-answer-silent',
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
    expect(withoutThinking.rows.every((row) => row.type !== 'response' as string)).toBe(true);
    expect(withoutThinking.rows.filter((row) => row.type === 'section')).toHaveLength(1);
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

  it('unwraps shell envelope into shell content-layer preview without ok/trace_id', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now + 500,
      blocks: [
        {
          id: 'runtime-loop-shell',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { text: 'Checked types.', status: 'complete', toolCallIds: ['tool-shell'] },
          toolCalls: [
            {
              id: 'tool-shell',
              toolName: 'shell',
              status: 'complete',
              argsPreview: JSON.stringify({ command: 'npm run typecheck' }),
              resultPreview: JSON.stringify({
                ok: true,
                data: {
                  content: [{ type: 'text', text: '> tsc\nFound 0 errors.' }],
                  details: { command: 'npm run typecheck', exitCode: 0, durationMs: 120 },
                },
                duration_ms: 120,
                trace_id: 'tool-shell',
              }),
              startedAt: now,
              completedAt: now + 120,
            },
          ],
          startedAt: now,
          completedAt: now + 120,
        },
      ],
    });

    const shellRow = flattenWorkRows(presentation.rows).find(
      (row) => row.type === 'tool' && row.toolName === 'shell',
    );
    expect(shellRow).toMatchObject({
      type: 'tool',
      family: 'shell',
      previewKind: 'shell',
      commandText: 'npm run typecheck',
    });
    if (!shellRow || shellRow.type !== 'tool') throw new Error('expected shell tool row');
    const preview = shellRow.previewLines.join('\n');
    expect(preview).toContain('Found 0 errors.');
    expect(preview).not.toContain('trace_id');
    expect(preview).not.toContain('duration_ms');
    expect(preview).not.toMatch(/"ok"\s*:/);
    expect(shellRow.rawLines.join('\n')).toContain('trace_id');
  });

  it('projects skill_read as a short description plus path chip, not full markdown', () => {
    const skillMarkdown = [
      '---',
      'name: arming-thought',
      'description: Establish qiushi principles at conversation start.',
      '---',
      '',
      '# Arming Thought',
      '',
      'Long body that must not fill the preview pane.',
      '',
      '## More',
      '',
      `${'x'.repeat(400)}`,
    ].join('\n');
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now + 500,
      blocks: [
        {
          id: 'runtime-loop-skill',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { text: 'Loaded skill.', status: 'complete', toolCallIds: ['tool-skill'] },
          toolCalls: [
            {
              id: 'tool-skill',
              toolName: 'skill_read',
              status: 'complete',
              argsPreview: JSON.stringify({ skill_id: 'arming-thought' }),
              resultPreview: JSON.stringify({
                ok: true,
                data: {
                  content: [{ type: 'text', text: skillMarkdown }],
                  details: {
                    skillId: 'arming-thought',
                    description: 'Establish qiushi principles at conversation start.',
                    sourcePath: 'C:/Users/Vip/.codex/skills/arming-thought/SKILL.md',
                  },
                },
                duration_ms: 40,
                trace_id: 'tool-skill',
              }),
              startedAt: now,
              completedAt: now + 40,
            },
          ],
          startedAt: now,
          completedAt: now + 40,
        },
      ],
    });

    const skillRow = flattenWorkRows(presentation.rows).find(
      (row) => row.type === 'tool' && row.toolName === 'skill_read',
    );
    expect(skillRow).toMatchObject({
      type: 'tool',
      family: 'skill',
      previewKind: 'skill',
      target: 'arming-thought',
      pathChip: 'C:/Users/Vip/.codex/skills/arming-thought/SKILL.md',
    });
    if (!skillRow || skillRow.type !== 'tool') throw new Error('expected skill tool row');
    expect(skillRow.previewLines).toHaveLength(1);
    expect(skillRow.previewLines[0]).toContain('Establish qiushi');
    expect(skillRow.previewLines.join('\n')).not.toContain('Long body that must not fill');
    expect(skillRow.previewLines.join('\n')).not.toContain('trace_id');
    expect(skillRow.rawLines.join('\n')).toContain('Long body that must not fill');
  });

  it('strips Unicode line gutters and projects file preview kind', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now + 600,
      blocks: [
        {
          id: 'runtime-loop-file',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { text: 'Read yaml.', status: 'complete', toolCallIds: ['tool-read'] },
          toolCalls: [
            {
              id: 'tool-read',
              toolName: 'read_file',
              status: 'complete',
              argsPreview: JSON.stringify({ path: '.rdc-agent/project.yaml' }),
              resultPreview: JSON.stringify({
                ok: true,
                data: { content: [{ type: 'text', text: '1→schema_version: "1"\n2→name: "rdc"' }] },
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

    const readRow = flattenWorkRows(presentation.rows).find(
      (row) => row.type === 'tool' && row.toolName === 'read_file',
    );
    expect(readRow).toMatchObject({
      type: 'tool',
      family: 'file',
      previewKind: 'file',
      pathChip: '.rdc-agent/project.yaml',
    });
    if (!readRow || readRow.type !== 'tool') throw new Error('expected read tool row');
    expect(readRow.previewLines.join('\n')).toContain('schema_version');
    expect(readRow.previewLines.join('\n')).not.toContain('→');
  });

  it('projects glob outcome-first body from production envelope details', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now + 16,
      blocks: [
        {
          id: 'runtime-loop-glob',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { text: 'Listed.', status: 'complete', toolCallIds: ['tool-glob'] },
          toolCalls: [
            {
              id: 'tool-glob',
              toolName: 'glob',
              status: 'complete',
              argsPreview: JSON.stringify({ pattern: '**/*' }),
              resultPreview: JSON.stringify({
                ok: true,
                data: {
                  content: [{ type: 'text', text: 'src/a.ts\nsrc/b.ts\nREADME.md' }],
                  details: { pattern: '**/*', cwd: '.', matched: 3, truncated: false },
                },
                duration_ms: 16,
              }),
              startedAt: now,
              completedAt: now + 16,
            },
          ],
          startedAt: now,
          completedAt: now + 16,
        },
      ],
    });

    const globRow = flattenWorkRows(presentation.rows).find(
      (row) => row.type === 'tool' && row.toolName === 'glob',
    );
    if (!globRow || globRow.type !== 'tool') throw new Error('expected glob tool row');
    expect(globRow.family).toBe('search');
    expect(globRow.bodyText).toBe('3 files');
    expect(globRow.bodyText).not.toBe('**/*');
    expect(globRow.bodyLines).toEqual(['src/a.ts', 'src/b.ts', 'README.md']);
    expect(globRow.previewLines).toContain('src/a.ts');
    expect(globRow.target).toBe('**/*');
  });

  it('projects read_file totalLines into collapsed bodyText', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now + 10,
      blocks: [
        {
          id: 'runtime-loop-read-lines',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { text: 'Read.', status: 'complete', toolCallIds: ['tool-read-lines'] },
          toolCalls: [
            {
              id: 'tool-read-lines',
              toolName: 'read_file',
              status: 'complete',
              argsPreview: JSON.stringify({ path: 'DESIGN.md' }),
              resultPreview: JSON.stringify({
                ok: true,
                data: {
                  content: [{ type: 'text', text: '     1→# Design\n     2→body' }],
                  details: { path: 'DESIGN.md', totalLines: 240, offset: 1, limit: 2000, truncated: false },
                },
              }),
              startedAt: now,
              completedAt: now + 10,
            },
          ],
          startedAt: now,
          completedAt: now + 10,
        },
      ],
    });

    const readRow = flattenWorkRows(presentation.rows).find(
      (row) => row.type === 'tool' && row.toolName === 'read_file',
    );
    if (!readRow || readRow.type !== 'tool') throw new Error('expected read tool row');
    expect(readRow.bodyText).toBe('DESIGN.md · 240 lines');
    expect(readRow.pathChip).toBe('DESIGN.md');
  });

  it('shows a session:// chip and short hash for artifactized tool results', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now,
      blocks: [{
        id: 'loop-artifact',
        kind: 'llm_turn',
        title: 'LLM turn',
        status: 'complete',
        toolCalls: [{
          id: 'tool-artifact',
          toolName: 'grep',
          status: 'complete',
          argsPreview: JSON.stringify({ pattern: 'foo' }),
          resultPreview: JSON.stringify({
            ok: true,
            data: {
              content: [{ type: 'text', text: 'Offloaded grep matches' }],
              details: {
                artifactized: true,
                ref: 'session://tool-outputs/call-9.json',
                hash: 'abcdef0123456789ffff',
                summary: 'Offloaded grep matches',
              },
            },
          }),
          startedAt: now,
          completedAt: now + 8,
        }],
        startedAt: now,
        completedAt: now + 8,
      }],
    });
    const row = flattenWorkRows(presentation.rows).find(
      (entry) => entry.type === 'tool' && entry.toolName === 'grep',
    );
    if (!row || row.type !== 'tool') throw new Error('expected artifactized tool row');
    expect(row.pathChip).toBe('session://tool-outputs/call-9.json');
    expect(row.chips).toEqual(['abcdef01']);
  });

  it('projects adjacent task snapshots with N of M counts and task anchors', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now + 40,
      blocks: [{
        id: 'task-snapshot-1',
        kind: 'task_snapshot',
        title: '2 of 3 completed',
        status: 'complete',
        taskSnapshot: {
          completed: 2,
          total: 3,
          items: [
            { taskId: 'task-a', title: 'Inspect capture', status: 'completed', order: 0 },
            { taskId: 'task-b', title: 'Write notes', status: 'completed', order: 1 },
            { taskId: 'task-c', title: 'Publish output', status: 'pending', order: 2 },
          ],
        },
        toolCalls: [],
        startedAt: now,
        completedAt: now + 20,
      }],
    });
    const row = flattenWorkRows(presentation.rows).find((entry) => entry.type === 'taskSnapshot');
    expect(row).toEqual(expect.objectContaining({
      type: 'taskSnapshot',
      completed: 2,
      total: 3,
    }));
    if (!row || row.type !== 'taskSnapshot') throw new Error('expected task snapshot');
    expect(row.items.map((item) => item.taskId)).toEqual(['task-a', 'task-b', 'task-c']);
  });

  it('keeps one live task snapshot card when later work arrives after the snapshot', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now + 80,
      blocks: [
        {
          id: 'task-snapshot-turn-1', kind: 'task_snapshot', title: '1 of 1 completed', status: 'complete',
          taskSnapshot: { completed: 1, total: 1, items: [{ taskId: 'task-a', title: 'One', status: 'completed', order: 0 }] },
          toolCalls: [], startedAt: now, completedAt: now + 35,
        },
        {
          id: 'loop-shell', kind: 'llm_turn', title: 'LLM turn', status: 'complete',
          result: { text: 'ran', status: 'complete', toolCallIds: ['shell-1'] },
          toolCalls: [{
            id: 'shell-1', toolName: 'shell', status: 'complete',
            argsPreview: JSON.stringify({ command: 'dir' }),
            resultPreview: JSON.stringify({ ok: true, data: { content: [{ type: 'text', text: 'ok' }] } }),
            startedAt: now + 10, completedAt: now + 20,
          }],
          startedAt: now + 10, completedAt: now + 20,
        },
      ],
    });
    const snapshots = flattenWorkRows(presentation.rows).filter((entry) => entry.type === 'taskSnapshot');
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toEqual(expect.objectContaining({ id: 'task-snapshot-turn-1', completed: 1, total: 1 }));
  });

  it('projects memory and interpreter families with chips and code body', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now + 20,
      blocks: [{
        id: 'runtime-loop-families',
        kind: 'llm_turn',
        title: 'LLM turn',
        status: 'complete',
        result: { text: 'done', status: 'complete', toolCallIds: ['mem-1', 'py-1'] },
        toolCalls: [
          {
            id: 'mem-1',
            toolName: 'memory_search',
            status: 'complete',
            argsPreview: JSON.stringify({ query: 'compositor', scope: 'project' }),
            resultPreview: JSON.stringify({
              ok: true,
              data: { content: [{ type: 'text', text: 'Last model override lived on the session.' }] },
            }),
            startedAt: now,
            completedAt: now + 5,
          },
          {
            id: 'py-1',
            toolName: 'code_interpreter',
            status: 'complete',
            argsPreview: JSON.stringify({ code: 'print(1)' }),
            resultPreview: JSON.stringify({
              ok: true,
              data: { content: [{ type: 'text', text: '1' }], details: { command: 'python', exitCode: 0 } },
            }),
            startedAt: now + 6,
            completedAt: now + 10,
          },
        ],
        startedAt: now,
        completedAt: now + 10,
      }],
    });
    const rows = flattenWorkRows(presentation.rows);
    const memory = rows.find((row) => row.type === 'tool' && row.toolName === 'memory_search');
    const interpreter = rows.find((row) => row.type === 'tool' && row.toolName === 'code_interpreter');
    expect(memory).toEqual(expect.objectContaining({
      type: 'tool',
      family: 'memory',
      chips: ['compositor', 'project'],
      bodyText: 'Last model override lived on the session.',
    }));
    expect(interpreter).toEqual(expect.objectContaining({
      type: 'tool',
      family: 'interpreter',
      commandText: 'print(1)',
    }));
  });

  it('projects skill, mcp, and runtime families with structured body fields', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now + 20,
      blocks: [{
        id: 'runtime-loop-structured',
        kind: 'llm_turn',
        title: 'LLM turn',
        status: 'complete',
        result: { text: 'done', status: 'complete', toolCallIds: ['sk-1', 'mcp-1', 'ts-1', 'out-1'] },
        toolCalls: [
          {
            id: 'sk-1',
            toolName: 'skill_read',
            status: 'complete',
            argsPreview: JSON.stringify({ skill_id: 'arming-thought' }),
            resultPreview: JSON.stringify({
              ok: true,
              data: {
                content: [{ type: 'text', text: 'Establish principles.' }],
                details: { skillId: 'arming-thought', sourcePath: '/skills/arming-thought/SKILL.md' },
              },
            }),
            startedAt: now,
            completedAt: now + 4,
          },
          {
            id: 'mcp-1',
            toolName: 'mcp__browser__navigate',
            status: 'complete',
            argsPreview: JSON.stringify({ url: 'https://example.com' }),
            resultPreview: JSON.stringify({
              ok: true,
              data: { content: [{ type: 'text', text: 'Opened example.com' }] },
            }),
            startedAt: now + 5,
            completedAt: now + 8,
          },
          {
            id: 'ts-1',
            toolName: 'tool_search',
            status: 'complete',
            argsPreview: JSON.stringify({ query: 'image' }),
            resultPreview: JSON.stringify({
              matches: ['read_image', 'code_interpreter'],
            }),
            startedAt: now + 9,
            completedAt: now + 12,
          },
          {
            id: 'out-1',
            toolName: 'output_register',
            status: 'complete',
            argsPreview: JSON.stringify({ path: 'out/report.md' }),
            resultPreview: JSON.stringify({
              ok: true,
              data: { details: { path: 'out/report.md' } },
            }),
            startedAt: now + 13,
            completedAt: now + 16,
          },
        ],
        startedAt: now,
        completedAt: now + 16,
      }],
    });
    const rows = flattenWorkRows(presentation.rows);
    expect(rows.find((row) => row.type === 'tool' && row.toolName === 'skill_read')).toEqual(
      expect.objectContaining({
        type: 'tool',
        family: 'skill',
        chips: ['arming-thought'],
        pathChip: '/skills/arming-thought/SKILL.md',
      }),
    );
    expect(rows.find((row) => row.type === 'tool' && row.toolName === 'mcp__browser__navigate')).toEqual(
      expect.objectContaining({
        type: 'tool',
        family: 'mcp',
        chips: ['MCP · browser', 'navigate'],
      }),
    );
    expect(rows.find((row) => row.type === 'tool' && row.toolName === 'tool_search')).toEqual(
      expect.objectContaining({
        type: 'tool',
        family: 'runtime',
        bodyLines: ['read_image', 'code_interpreter'],
      }),
    );
    expect(rows.find((row) => row.type === 'tool' && row.toolName === 'output_register')).toEqual(
      expect.objectContaining({
        type: 'tool',
        family: 'runtime',
        pathChip: 'out/report.md',
      }),
    );
  });

  it('renders awaiting plan_artifact as a planReview card and rejected as a shell row', () => {
    const awaiting: ConversationPlanReview = {
      planId: 'plan-1',
      revision: 2,
      uri: 'session://plans/plan.md',
      hash: 'a'.repeat(64),
      title: '导入后再诊断',
      summary: ['导入 capture'],
      sections: [{ heading: '目标与边界', body: '定位 First Bad Event。' }],
      status: 'awaiting',
      handoffOptions: [{ label: 'Execute with General', agent: 'general' }],
    };
    const card = createToolRowForPresentation({
      id: 'plan-live',
      toolName: 'plan_artifact',
      status: 'running',
      planReview: awaiting,
      argsPreview: JSON.stringify({ title: awaiting.title }),
      startedAt: now,
    });
    expect(card).toMatchObject({ type: 'planReview', plan: awaiting });

    const shell = createToolRowForPresentation({
      id: 'plan-rejected',
      toolName: 'plan_artifact',
      status: 'complete',
      planReview: {
        ...awaiting,
        revision: 1,
        status: 'rejected',
        decision: { kind: 'reject', feedback: '请补上复现条件。' },
      },
      resultPreview: '请补上复现条件。',
      startedAt: now,
      completedAt: now + 10,
    });
    expect(shell).toMatchObject({
      type: 'tool',
      verb: '已更新计划 · 已拒绝',
      bodyText: '请补上复现条件。',
    });
  });
});
