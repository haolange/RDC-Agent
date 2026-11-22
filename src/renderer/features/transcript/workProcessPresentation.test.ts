import { describe, expect, it } from 'vitest';
import { translate } from '../../i18n/messages';
import { buildWorkProcessPresentation } from './workProcessTracePresentation';
import { createToolRowForPresentation } from './workProcessToolRows';
import { createApprovalRow } from './workProcessDecisionRows';
import type {
  ConversationTextItem,
  ConversationThinkingItem,
  ConversationThinkingStatus,
  ConversationWorkTrace,
} from '@shared/types/conversation';
import type { ConversationPlanReview } from '@shared/types/planReview';
import type { ThinkingArtifact } from '@shared/types/reasoning';

const t = (key: import('../../i18n/messages').TranslationKey, params?: Record<string, string | number>) => translate('zh-CN', key, params);

const now = 1_700_000_000_000;

const rawThinking = { kind: 'raw', source: 'openai-compatible-raw', visibility: 'raw-collapsed' } as const;

/** One provider thinking block; defaults to a settled summary. */
function thinkingItem(
  text: string,
  displayOrder: number,
  options: Partial<Pick<ThinkingArtifact, 'kind' | 'source' | 'visibility'>> & { status?: ConversationThinkingStatus } = {},
): ConversationThinkingItem {
  const { status = 'complete', ...artifact } = options;
  return {
    kind: 'thinking', status, displayOrder,
    providerOutputRef: { protocol: 'test', providerBlockKey: `thinking-${displayOrder}`, contentIndex: displayOrder },
    thinking: { text, kind: 'summary', source: 'anthropic-thinking', visibility: 'summary', ...artifact },
  };
}

/** One provider text block; defaults to settled commentary. */
function textItem(text: string, displayOrder: number, overrides: Partial<ConversationTextItem> = {}): ConversationTextItem {
  return {
    kind: 'text', text, phase: 'commentary', status: 'complete', displayOrder,
    providerOutputRef: { protocol: 'test', providerBlockKey: `text-${displayOrder}`, contentIndex: displayOrder },
    ...overrides,
  };
}

it.each([
  ['rule', 'approved', undefined, '规则检查通过'],
  ['model', 'approved', undefined, '独立审核通过'],
  ['model', 'rejected', undefined, '独立审核未通过'],
  ['model', 'rejected', 'PERMISSION_REVIEW_TIMEOUT', '审核未完成'],
  ['model', 'cancelled', 'PERMISSION_REVIEW_CANCELLED', '已取消'],
  [undefined, 'rejected', undefined, '自动审查未通过'],
] as const)('projects host review route %s, status %s and error %s independently', (reviewMethod, status, errorCode, verb) => {
  const row = createToolRowForPresentation({ id: 'review', toolName: 'shell', status: 'error', startedAt: now,
    approval: { approvalId: 'auto-review-call', status, reviewer: 'auto_review', reviewMethod, errorCode,
      risk: 'high', reason: 'PERMISSION_REVIEW_TIMEOUT: model text alone does not classify failures', requestedAt: now },
  }, t);
  expect(row).toMatchObject({ type: 'tool', approval: { verb } });
  if (row.type !== 'tool') throw new Error('Expected tool row');
  expect(row.approval?.metaLines.includes('操作未执行')).toBe(status === 'rejected');
  if (!reviewMethod) expect(row.approval?.metaLines).toContain('自动审查');
});

it('keeps a post-approval native error separate from an operation-preflight rejection', () => {
  const row = createToolRowForPresentation({ id: 'native', toolName: 'shell', status: 'error', startedAt: now,
    error: 'Native process exited with code 1',
    approval: { approvalId: 'auto-review-native', status: 'approved', reviewer: 'auto_review', reviewMethod: 'model', requestedAt: now },
  }, t);
  expect(row).toMatchObject({ type: 'tool', status: 'error', approval: { verb: '独立审核通过' } });
  if (row.type !== 'tool') throw new Error('Expected tool row');
  expect(row.approval?.metaLines).not.toContain('操作未执行');
  expect(row.verb).not.toBe('已阻断');
});

it.each(['tool-approval', 'auto-review-approval'])('does not label cancelled %s as approved', id => {
  expect(createApprovalRow({ id, kind: 'approval', title: 'Approval', status: 'cancelled',
    toolCalls: [], startedAt: now, completedAt: now + 10 }, t)).toMatchObject({
    type: 'approval', status: 'cancelled', verb: '已取消',
  });
});

type WorkRow = ReturnType<typeof buildWorkProcessPresentation>['rows'][number];

function flattenWorkRows(rows: WorkRow[]): WorkRow[] {
  return rows.flatMap((row) => {
    if (row.type === 'section') return [row, ...flattenWorkRows(row.steps)];
    if (row.type === 'toolAggregate') return [row, ...row.children];
    return [row];
  });
}

function rowsOfType<Type extends WorkRow['type']>(rows: WorkRow[], type: Type): Array<Extract<WorkRow, { type: Type }>> {
  return flattenWorkRows(rows).filter((row): row is Extract<WorkRow, { type: Type }> => row.type === type);
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
    }, t);
    const rows = flattenWorkRows(presentation.rows);
    expect(rows.filter((row) => row.type === 'subagent')).toMatchObject([
      { id: 'delegate-1', task: 'Read inputs', status: 'complete' },
      { id: 'delegate-2', task: 'Read config', status: 'running', executionId: 'exec-2' },
    ]);
    expect(rows.filter((row) => row.type === 'tool' && row.toolName === 'subagent')).toHaveLength(0);
  });
  it('keeps both completed checkpoints in the visible history', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now + 20,
      blocks: [
        { id: 'compact-1', kind: 'compaction', title: 'Context compacted', summary: 'old counts', status: 'complete', toolCalls: [], startedAt: now, completedAt: now + 5 },
        { id: 'compact-2', kind: 'compaction', title: 'Context compacted', summary: 'new counts', status: 'complete', toolCalls: [], startedAt: now + 10, completedAt: now + 15 },
      ],
    }, t);
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
    }, t);
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
    }, t);
    const row = flattenWorkRows(presentation.rows).find((entry) => entry.type === 'taskSnapshot');
    expect(row).toEqual(expect.objectContaining({ type: 'taskSnapshot', completed: 0, total: 1 }));
    if (!row || row.type !== 'taskSnapshot') throw new Error('expected task snapshot');
    expect(row.items).toEqual([expect.objectContaining({
      taskId: 'task-1', title: 'Wait for QA', status: 'blocked', statusReason: 'QA waiting', order: 0,
    })]);
  });

  it('projects streaming commentary as an output row without promoting it into thinking', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'running',
      updatedAt: now,
      blocks: [
        {
          id: 'runtime-loop-prose',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'running',
          result: { status: 'streaming', toolCallIds: [], outputPhase: 'commentary' },
          items: [textItem('Inspecting capture metadata', 1, { status: 'streaming' })],
          toolCalls: [],
          startedAt: now,
        },
      ],
    }, t);

    expect(rowsOfType(presentation.rows, 'output')).toEqual([expect.objectContaining({
      text: 'Inspecting capture metadata', phase: 'commentary', status: 'running',
    })]);
    expect(rowsOfType(presentation.rows, 'thinking')).toHaveLength(0);
  });

  it('keeps settled commentary text even when the loop has no tool calls', () => {
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
            status: 'complete',
            toolCallIds: ['ask-1'],
            stopReason: 'tool_use',
            outputPhase: 'commentary',
          },
          items: [textItem('Need a few answers first.', 1)],
          toolCalls: [
            {
              id: 'ask-1',
              toolName: 'ask_user',
              status: 'complete',
              argsPreview: JSON.stringify({ questions: [{ prompt: 'Drink?' }] }),
              resultPreview: JSON.stringify({ answers: [{ answer: '茶' }] }),
              displayOrder: 2,
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
            status: 'complete',
            toolCallIds: [],
            stopReason: 'end_turn',
            outputPhase: 'commentary',
          },
          items: [textItem('Thanks — summarizing the parameter combinations next.', 3)],
          toolCalls: [],
          startedAt: now + 600,
          completedAt: now + 900,
        },
      ],
    }, t);

    const sections = presentation.rows.filter((row) => row.type === 'section');
    expect(sections.map((section) => rowsOfType(section.steps, 'output').map((row) => row.text))).toEqual([
      ['Need a few answers first.'],
      ['Thanks — summarizing the parameter combinations next.'],
    ]);
  });

  it('tags settled final_answer text as the answer instead of commentary', () => {
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
            status: 'complete',
            toolCallIds: ['tool-read'],
            stopReason: 'tool_use',
            outputPhase: 'commentary',
          },
          items: [textItem('Checking files.', 1)],
          toolCalls: [
            {
              id: 'tool-read',
              toolName: 'read_file',
              status: 'complete',
              argsPreview: JSON.stringify({ path: 'a.ts' }),
              resultPreview: JSON.stringify({ ok: true }),
              displayOrder: 2,
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
            status: 'complete',
            toolCallIds: [],
            stopReason: 'end_turn',
            outputPhase: 'final_answer',
          },
          items: [textItem('Final answer body only', 3, { phase: 'final_answer' })],
          toolCalls: [],
          startedAt: now + 300,
          completedAt: now + 400,
        },
      ],
    }, t);

    expect(rowsOfType(presentation.rows, 'output').map(({ text, phase }) => ({ text, phase }))).toEqual([
      { text: 'Checking files.', phase: 'commentary' },
      { text: 'Final answer body only', phase: 'final_answer' },
    ]);
  });

  it('keeps streaming final_answer text tagged as the answer', () => {
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
            status: 'complete',
            toolCallIds: [],
            stopReason: 'end_turn',
            outputPhase: 'commentary',
          },
          items: [textItem('Need a few answers first.', 1)],
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
            status: 'streaming',
            toolCallIds: [],
            outputPhase: 'final_answer',
          },
          items: [textItem('Streaming final answer tokens after ask_user.', 2, { phase: 'final_answer', status: 'streaming' })],
          toolCalls: [],
          startedAt: now + 500,
        },
      ],
    }, t);

    expect(rowsOfType(presentation.rows, 'output').map(({ text, phase, status }) => ({ text, phase, status }))).toEqual([
      { text: 'Need a few answers first.', phase: 'commentary', status: 'complete' },
      { text: 'Streaming final answer tokens after ask_user.', phase: 'final_answer', status: 'running' },
    ]);
  });

  it('uses Thought-for settled labels with the thinking block\'s own streaming time', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now + 1000,
      blocks: [
        {
          id: 'runtime-loop-thought',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { status: 'complete', toolCallIds: ['tool-read'] },
          items: [
            { ...thinkingItem('raw chain-of-thought that must not be result text', 1, rawThinking), startedAt: now, completedAt: now + 1500 },
            textItem('Read files before answering.', 2),
          ],
          toolCalls: [
            {
              id: 'tool-read',
              toolName: 'read_file',
              status: 'complete',
              argsPreview: JSON.stringify({ path: 'README.md' }),
              resultPreview: JSON.stringify({ content: 'hello' }),
              displayOrder: 3,
              startedAt: now + 1500,
              completedAt: now + 1600,
            },
          ],
          startedAt: now,
          completedAt: now + 1600,
        },
      ],
    }, t);

    expect(rowsOfType(presentation.rows, 'thinking')).toEqual([expect.objectContaining({
      label: '已思考 · 1.5s',
      preview: 'raw chain-of-thought that must not be result text',
      expandable: true,
      openByDefault: false,
    })]);
    expect(rowsOfType(presentation.rows, 'output').map((row) => row.text)).toEqual(['Read files before answering.']);
  });

  it('keeps each thinking block of one loop as its own row around the tool between them', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now + 300,
      blocks: [{
        id: 'runtime-loop-interleaved', kind: 'llm_turn', title: 'LLM turn', status: 'complete',
        result: { status: 'complete', stopReason: 'tool_use', outputPhase: 'commentary', toolCallIds: ['tool-read'] },
        items: [thinkingItem('Locate the config first.', 1), thinkingItem('The config confirms the cause.', 3)],
        toolCalls: [{
          id: 'tool-read', toolName: 'read_file', status: 'complete', displayOrder: 2,
          argsPreview: JSON.stringify({ path: 'config.json' }), resultPreview: '{}',
          startedAt: now + 100, completedAt: now + 200,
        }],
        startedAt: now,
        completedAt: now + 300,
      }],
    }, t);

    const section = presentation.rows.find((row) => row.type === 'section');
    if (section?.type !== 'section') throw new Error('expected section');
    expect(section.steps.map((step) => step.type)).toEqual(['thinking', 'tool', 'thinking']);
    expect(rowsOfType(section.steps, 'thinking').map((row) => row.preview)).toEqual([
      'Locate the config first.',
      'The config confirms the cause.',
    ]);
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
          result: { status: 'streaming', toolCallIds: ['tool-glob'] },
          items: [thinkingItem('planning next step', 1, { status: 'streaming' })],
          toolCalls: [
            {
              id: 'tool-glob',
              toolName: 'glob',
              status: 'running',
              argsPreview: JSON.stringify({ pattern: '**/*' }),
              displayOrder: 2,
              startedAt: now + 100,
            },
          ],
          startedAt: now,
        },
      ],
    }, t);

    expect(rowsOfType(presentation.rows, 'thinking')).toEqual([expect.objectContaining({
      label: '正在思考',
      thinkingStatus: 'streaming',
      expandable: true,
      openByDefault: true,
    })]);
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
            status: 'streaming',
            toolCallIds: [],
            stopReason: 'end_turn',
            outputPhase: 'final_answer',
          },
          items: [thinkingItem('compose a short identity answer', 1, { ...rawThinking, status: 'streaming' })],
          toolCalls: [],
          startedAt: now,
        },
      ],
    }, t);
    expect(rowsOfType(presentation.rows, 'thinking')).toEqual([expect.objectContaining({
      openByDefault: true,
      label: '正在思考',
    })]);
  });

  it('shows settled thinking while the turn awaits plan review', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'running', updatedAt: now + 100,
      blocks: [{
        id: 'runtime-loop-plan-review', kind: 'llm_turn', title: 'LLM turn', status: 'running',
        result: { status: 'streaming', toolCallIds: ['plan-call'] },
        items: [thinkingItem('Plan is ready', 1, { source: 'openai-responses-summary' })],
        startedAt: now, completedAt: now + 100,
        toolCalls: [{ id: 'plan-call', toolName: 'plan_artifact', status: 'running', displayOrder: 2, startedAt: now + 100,
          planReview: { planId: 'plan-1', revision: 1, uri: 'session://plans/plan.md',
            hash: 'a'.repeat(64), title: 'Plan', summary: [], sections: [], status: 'awaiting',
            handoffOptions: [{ label: 'Execute with General', agent: 'general' }] } }],
      }],
    }, t);
    expect(rowsOfType(presentation.rows, 'thinking')).toEqual([expect.objectContaining({
      label: expect.stringMatching(/^已思考/),
      openByDefault: false,
    })]);
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
          result: { status: 'streaming', toolCallIds: ['tool-glob-raw'] },
          items: [thinkingItem('live raw thinking', 1, { ...rawThinking, status: 'streaming' })],
          toolCalls: [
            {
              id: 'tool-glob-raw',
              toolName: 'glob',
              status: 'running',
              argsPreview: JSON.stringify({ pattern: '**/*' }),
              displayOrder: 2,
              startedAt: now + 100,
            },
          ],
          startedAt: now,
        },
      ],
    }, t);
    expect(rowsOfType(active.rows, 'thinking')).toEqual([expect.objectContaining({
      openByDefault: true,
      label: '正在思考',
    })]);

    const settled = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now + 1000,
      blocks: [
        {
          id: 'runtime-loop-raw-closed',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { status: 'complete', toolCallIds: ['tool-glob-raw-done'] },
          items: [{ ...thinkingItem('settled raw thinking', 1, rawThinking), startedAt: now, completedAt: now + 100 }],
          toolCalls: [
            {
              id: 'tool-glob-raw-done',
              toolName: 'glob',
              status: 'complete',
              argsPreview: JSON.stringify({ pattern: '**/*' }),
              resultPreview: JSON.stringify({ files: ['a.ts'] }),
              displayOrder: 2,
              startedAt: now + 100,
              completedAt: now + 200,
            },
          ],
          startedAt: now,
          completedAt: now + 200,
        },
      ],
    }, t);
    expect(rowsOfType(settled.rows, 'thinking')).toEqual([expect.objectContaining({
      openByDefault: false,
      label: '已思考 · 100ms',
    })]);
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
          result: { status: 'complete', toolCallIds: [] },
          items: [thinkingItem('summary only', 1)],
          toolCalls: [],
          startedAt: undefined as unknown as number,
          completedAt: undefined,
        },
      ],
    }, t);

    expect(rowsOfType(presentation.rows, 'thinking').map((row) => row.label)).toEqual(['已思考']);
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
    }, t);

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
    }, t);

    const section = presentation.rows.find((row) => row.type === 'section');
    const visibleSteps = section?.type === 'section' ? section.visibleSteps : [];
    expect(visibleSteps.map((row) => row.type)).toEqual(Array(7).fill('tool'));
  });

  it('retains skipped audit counts without projecting calls that never executed', () => {
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
    }, t);

    expect(presentation.toolEvidence).toEqual({ total: 3, succeeded: 1, failed: 1, skipped: 1 });
    expect(flattenWorkRows(presentation.rows)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'tool', id: 'failed', status: 'error' }),
    ]));
    expect(flattenWorkRows(presentation.rows).some((row) => row.id === 'skipped')).toBe(false);
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
    }, t);

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
          result: { status: 'complete', toolCallIds: ['tool-git'] },
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
    }, t);

    const tool = flattenWorkRows(presentation.rows).find((row) => row.type === 'tool');
    expect(tool).toMatchObject({
      type: 'tool',
      status: 'error',
      verb: '执行失败',
      diagnosticCaption: 'fatal: not a git repository (or any of the parent directories): .git',
    });
    expect(tool?.type === 'tool' ? tool.diagnosticCaption : '').not.toMatch(/^\s*\{/);
  });

  it('says a runtime rejection once, as its reason, and keeps the coded text in the raw receipt', () => {
    const error = 'TOOL_SCHEMA_VIOLATION: [plan_artifact] args.summary: 数组元素数不得大于 4（实际: 5）';
    const presentation = buildWorkProcessPresentation({
      status: 'error',
      updatedAt: now,
      blocks: [{
        id: 'runtime-loop-schema', kind: 'llm_turn', title: 'LLM turn', status: 'error',
        result: { status: 'complete', toolCallIds: ['tool-plan'] },
        toolCalls: [{ id: 'tool-plan', toolName: 'plan_artifact', status: 'error', argsPreview: '{}', error, startedAt: now, completedAt: now + 5 }],
        startedAt: now, completedAt: now + 5,
      }],
    }, t);

    const tool = flattenWorkRows(presentation.rows).find((row) => row.type === 'tool');
    if (tool?.type !== 'tool') throw new Error('expected a tool row');
    expect(tool.diagnosticCaption).toBe('数组元素数不得大于 4（实际: 5）');
    expect(tool.previewLines).toEqual([]);
    expect(tool.rawLines.join('\n')).toContain('TOOL_SCHEMA_VIOLATION');
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
          result: { status: 'complete', toolCallIds: ['tool-1'] },
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
          result: { status: 'complete', toolCallIds: [], stopReason: 'end_turn', outputPhase: 'final_answer' },
          items: [thinkingItem('Closing thoughts before the reply.', 1)],
          toolCalls: [],
          startedAt: now + 20,
          completedAt: now + 40,
        },
      ],
    }, t);

    expect(withThinking.rows.every((row) => row.type !== 'response' as string)).toBe(true);
    const closing = withThinking.rows.filter((row) => row.type === 'section').at(-1);
    expect(closing).toMatchObject({
      type: 'section',
      loopId: 'runtime-loop-answer',
      stepCount: 0,
      steps: [expect.objectContaining({ type: 'thinking', preview: 'Closing thoughts before the reply.', expandable: true })],
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
          result: { status: 'complete', toolCallIds: ['tool-2'] },
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
          result: { status: 'complete', toolCallIds: [], stopReason: 'end_turn', outputPhase: 'final_answer' },
          toolCalls: [],
          startedAt: now + 20,
          completedAt: now + 40,
        },
      ],
    }, t);
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
          result: { status: 'complete', toolCallIds: ['t1'] },
          items: [thinkingItem('think', 1), textItem('Stable.', 2)],
          toolCalls: [
            {
              id: 't1',
              toolName: 'glob',
              status: 'complete',
              argsPreview: JSON.stringify({ pattern: '*' }),
              resultPreview: '{}',
              displayOrder: 3,
              startedAt: now + 200,
              completedAt: now + 220,
            },
          ],
          startedAt: now,
          completedAt: now + 220,
        },
      ],
    };

    expect(buildWorkProcessPresentation(trace, t)).toEqual(buildWorkProcessPresentation(trace, t));
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
          result: { status: 'complete', toolCallIds: ['tool-shell'] },
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
    }, t);

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
          result: { status: 'complete', toolCallIds: ['tool-skill'] },
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
    }, t);

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
          result: { status: 'complete', toolCallIds: ['tool-read'] },
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
    }, t);

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
          result: { status: 'complete', toolCallIds: ['tool-glob'] },
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
    }, t);

    const globRow = flattenWorkRows(presentation.rows).find(
      (row) => row.type === 'tool' && row.toolName === 'glob',
    );
    if (!globRow || globRow.type !== 'tool') throw new Error('expected glob tool row');
    expect(globRow.family).toBe('search');
    expect(globRow.bodyText).toBe('3 个文件');
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
          result: { status: 'complete', toolCallIds: ['tool-read-lines'] },
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
    }, t);

    const readRow = flattenWorkRows(presentation.rows).find(
      (row) => row.type === 'tool' && row.toolName === 'read_file',
    );
    if (!readRow || readRow.type !== 'tool') throw new Error('expected read tool row');
    expect(readRow.bodyText).toBe('240 行');
    expect(readRow.pathChip).toBe('DESIGN.md');
  });

  it('keeps the session address and hash of an offloaded result out of the card', () => {
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
    }, t);
    const row = flattenWorkRows(presentation.rows).find(
      (entry) => entry.type === 'tool' && entry.toolName === 'grep',
    );
    if (!row || row.type !== 'tool') throw new Error('expected artifactized tool row');
    expect(row.pathChip).toBeUndefined();
    expect(row.chips).toBeUndefined();
    expect(row.previewLines).toEqual(['Offloaded grep matches']);
    expect(row.rawLines.join('\n')).toContain('session://tool-outputs/call-9.json');
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
    }, t);
    const row = flattenWorkRows(presentation.rows).find((entry) => entry.type === 'taskSnapshot');
    expect(row).toEqual(expect.objectContaining({
      type: 'taskSnapshot',
      completed: 2,
      total: 3,
    }));
    if (!row || row.type !== 'taskSnapshot') throw new Error('expected task snapshot');
    expect(row.items.map((item) => item.taskId)).toEqual(['task-a', 'task-b', 'task-c']);
  });

  it('projects separate historical task snapshots around later work', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now + 80,
      blocks: [
        {
          id: 'task-snapshot-created', kind: 'task_snapshot', title: 'Tasks added', status: 'complete',
          taskSnapshot: { change: 'created', completed: 0, total: 1, items: [{ taskId: 'task-a', title: 'One', status: 'pending', order: 0 }] },
          toolCalls: [], startedAt: now, completedAt: now + 35,
        },
        {
          id: 'loop-shell', kind: 'llm_turn', title: 'LLM turn', status: 'complete',
          result: { status: 'complete', toolCallIds: ['shell-1'] },
          toolCalls: [{
            id: 'shell-1', toolName: 'shell', status: 'complete',
            argsPreview: JSON.stringify({ command: 'dir' }),
            resultPreview: JSON.stringify({ ok: true, data: { content: [{ type: 'text', text: 'ok' }] } }),
            startedAt: now + 10, completedAt: now + 20,
          }],
          startedAt: now + 10, completedAt: now + 20,
        },
        {
          id: 'task-snapshot-updated', kind: 'task_snapshot', title: 'Tasks updated', status: 'complete',
          taskSnapshot: { change: 'updated', completed: 1, total: 1, items: [{ taskId: 'task-a', title: 'One', status: 'completed', order: 0 }] },
          toolCalls: [], startedAt: now + 30, completedAt: now + 30,
        },
      ],
    }, t);
    const snapshots = flattenWorkRows(presentation.rows).filter((entry) => entry.type === 'taskSnapshot');
    expect(snapshots).toHaveLength(2);
    expect(snapshots).toEqual([
      expect.objectContaining({ id: 'task-snapshot-created', change: 'created', completed: 0 }),
      expect.objectContaining({ id: 'task-snapshot-updated', change: 'updated', completed: 1 }),
    ]);
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
        result: { status: 'complete', toolCallIds: ['mem-1', 'py-1'] },
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
    }, t);
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
        result: { status: 'complete', toolCallIds: ['sk-1', 'mcp-1', 'ts-1', 'out-1'] },
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
    }, t);
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
        // Found tools read by what they do, not by wire names.
        bodyLines: [t('chat.toolDisplay.read_image.category'), t('chat.toolDisplay.code_interpreter.category')],
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

  it('shows the current plan revision as the Working plan card and folds replaced revisions into one row', () => {
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
    }, t);
    expect(card).toMatchObject({ type: 'planReview', plan: awaiting, status: 'running' });

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
    }, t);
    expect(shell).toMatchObject({
      type: 'tool',
      verb: '计划 · 已提出修改',
      bodyText: '请补上复现条件。',
    });
  });
});
