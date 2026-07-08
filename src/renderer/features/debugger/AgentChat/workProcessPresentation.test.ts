import { describe, expect, it } from 'vitest';
import type { ConversationWorkTrace } from '@shared/types/conversation';
import { MAX_LOOPS_PER_GROUP } from './workProcessGrouping';
import { buildWorkProcessPresentation } from './workProcessPresentation';

const now = 1_700_000_000_000;

function flattenWorkRows(rows: ReturnType<typeof buildWorkProcessPresentation>['rows']): Array<(typeof rows)[number]> {
  return rows.flatMap((row) => {
    if (row.type === 'section') return [row, ...flattenWorkRows(row.steps)];
    if (row.type === 'toolGroup') return [row, ...flattenWorkRows(row.rows)];
    return [row];
  });
}

function flattenVisibleWorkRows(rows: ReturnType<typeof buildWorkProcessPresentation>['rows']): Array<(typeof rows)[number]> {
  return rows.flatMap((row) => {
    if (row.type === 'section') return [row, ...flattenVisibleWorkRows(row.visibleSteps)];
    if (row.type === 'toolGroup') return [row, ...flattenVisibleWorkRows(row.rows)];
    return [row];
  });
}

describe('buildWorkProcessPresentation', () => {
  it('keeps assistant answer streaming out of Work Process when there is no process evidence', () => {
    const trace: ConversationWorkTrace = {
      status: 'running',
      summary: 'Agent is working',
      updatedAt: now,
      blocks: [
        {
          id: 'runtime-loop-1',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'running',
          result: {
            text: 'Inspecting capture metadata',
            status: 'streaming',
            toolCallIds: [],
          },
          toolCalls: [],
          startedAt: now,
        },
      ],
    };

    const presentation = buildWorkProcessPresentation(trace);
    expect(presentation.defaultExpanded).toBe(true);
    expect(presentation.stepCount).toBe(0);
    expect(presentation.toolCount).toBe(0);
    expect(presentation.rows).toEqual([]);
  });

  it('does not fabricate empty body rows for a running trace with no events', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'running',
      updatedAt: now,
      blocks: [],
    });

    expect(presentation.rows).toEqual([]);
    expect(presentation.summary).toBe('');
    expect(presentation.defaultExpanded).toBe(true);
  });

  it('suppresses terminal reply-complete summary noise', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      summary: '回复已完成',
      updatedAt: now,
      blocks: [],
    });

    expect(presentation.summary).toBe('');
    expect(presentation.rows).toEqual([]);
  });

  it('keeps raw provider thinking available as collapsed process evidence', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now,
      blocks: [
        {
          id: 'runtime-loop-1',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: {
            text: 'Read files before answering.',
            status: 'complete',
            toolCallIds: ['tool-read'],
          },
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
              startedAt: now,
              completedAt: now + 10,
            },
          ],
          startedAt: now,
          completedAt: now + 10,
        },
      ],
    });

    const section = presentation.rows.find((row) => row.type === 'section');
    expect(section).toMatchObject({
      type: 'section',
      resultText: 'Read files before answering.',
      resultToolSummary: '',
      thinkingLabel: '原始思考',
      thinkingSource: '',
      thinkingPreview: 'raw chain-of-thought that must not be result text',
      thinkingExpandable: true,
      thinkingOpenByDefault: false,
      thinkingStatus: 'complete',
      defaultOpen: false,
    });
    expect(section?.type === 'section' ? section.thinkingPreview : '').toContain('raw chain-of-thought');
  });

  it('opens streaming summary thinking even without tool evidence', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'running',
      updatedAt: now,
      blocks: [
        {
          id: 'runtime-loop-thinking-result',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'running',
          result: {
            text: 'I found the relevant files.',
            status: 'streaming',
            toolCallIds: [],
          },
          thinking: {
            text: 'The model is planning the next tool call.',
            kind: 'summary',
            source: 'openai-responses-summary',
            visibility: 'summary',
            replayPolicy: 'none',
          },
          thinkingStatus: 'streaming',
          toolCalls: [],
          startedAt: now,
        },
      ],
    });

    const section = presentation.rows.find((row) => row.type === 'section');
    expect(section).toMatchObject({
      type: 'section',
      resultText: '',
      thinkingLabel: '正在思考',
      thinkingPreview: 'The model is planning the next tool call.',
      thinkingExpandable: true,
      thinkingOpenByDefault: true,
      thinkingStatus: 'streaming',
      stepCount: 0,
    });
  });

  it('shows completed summary thinking without duplicating the answer result', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now,
      blocks: [
        {
          id: 'runtime-loop-summary',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: {
            text: 'Turn result.',
            status: 'complete',
            toolCallIds: [],
          },
          thinking: {
            text: 'Provider summary for this turn.',
            kind: 'summary',
            source: 'openai-responses-summary',
            visibility: 'summary',
            replayPolicy: 'none',
          },
          thinkingStatus: 'complete',
          toolCalls: [],
          startedAt: now,
          completedAt: now + 10,
        },
      ],
    });

    const section = presentation.rows.find((row) => row.type === 'section');
    expect(section).toMatchObject({
      type: 'section',
      resultText: '',
      thinkingLabel: '思考',
      thinkingPreview: 'Provider summary for this turn.',
      thinkingExpandable: true,
      thinkingOpenByDefault: true,
      thinkingStatus: 'complete',
      stepCount: 0,
    });
  });

  it('deduplicates repeated provider summary thinking across adjacent model loops', () => {
    const repeatedSummary = 'I have all the answers from memory. Let me respond concisely in Chinese.';
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now,
      blocks: [
        {
          id: 'runtime-loop-before-tools',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { text: '', status: 'complete', toolCallIds: ['tool-read'] },
          thinking: {
            text: repeatedSummary,
            kind: 'summary',
            source: 'anthropic-thinking',
            visibility: 'summary',
            replayPolicy: 'provider-artifact',
          },
          thinkingStatus: 'complete',
          toolCalls: [
            { id: 'tool-read', toolName: 'read_file', status: 'complete', argsPreview: JSON.stringify({ path: 'project-identity' }), startedAt: now, completedAt: now + 10 },
          ],
          startedAt: now,
          completedAt: now + 10,
        },
        {
          id: 'runtime-loop-after-tools',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { text: '你好！我是 Edit。', status: 'complete', toolCallIds: [] },
          thinking: {
            text: repeatedSummary,
            kind: 'summary',
            source: 'anthropic-thinking',
            visibility: 'summary',
            replayPolicy: 'provider-artifact',
          },
          thinkingStatus: 'complete',
          toolCalls: [],
          startedAt: now + 20,
          completedAt: now + 30,
        },
      ],
    });

    const sections = presentation.rows.filter((row) => row.type === 'section');
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({
      thinkingLabel: '思考',
      thinkingPreview: repeatedSummary,
      thinkingExpandable: true,
      stepCount: 1,
    });
  });

  it('uses a final response boundary instead of a second process section for answer-only streaming', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'running',
      updatedAt: now,
      blocks: [
        {
          id: 'runtime-loop-before-answer',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { text: 'Need memory before answering.', status: 'complete', toolCallIds: ['tool-memory-read'] },
          thinking: {
            text: 'Read the identity and model memory before answering.',
            kind: 'summary',
            source: 'anthropic-thinking',
            visibility: 'summary',
            replayPolicy: 'provider-artifact',
          },
          thinkingStatus: 'complete',
          toolCalls: [
            { id: 'tool-memory-read', toolName: 'memory_read', status: 'complete', argsPreview: JSON.stringify({ key: 'project-identity' }), startedAt: now, completedAt: now + 10 },
          ],
          startedAt: now,
          completedAt: now + 10,
        },
        {
          id: 'assistant-output',
          kind: 'output',
          title: 'Assistant output ready',
          status: 'complete',
          summary: 'Final answer generated.',
          toolCalls: [],
          startedAt: now + 12,
          completedAt: now + 15,
        },
        {
          id: 'runtime-loop-final-answer',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'running',
          result: { text: 'Final answer body is streaming to the assistant message.', status: 'streaming', toolCallIds: [] },
          thinking: {
            text: 'I have enough information; now generate the final reply.',
            kind: 'summary',
            source: 'anthropic-thinking',
            visibility: 'summary',
            replayPolicy: 'provider-artifact',
          },
          thinkingStatus: 'streaming',
          toolCalls: [],
          startedAt: now + 20,
        },
      ],
    });

    expect(presentation.rows.map((row) => row.type)).toEqual(['section', 'response']);
    expect(presentation.rows.filter((row) => row.type === 'section')).toHaveLength(1);
    const response = presentation.rows.find((row) => row.type === 'response');
    expect(response).toMatchObject({
      type: 'response',
      status: 'running',
      thinkingPreview: 'I have enough information; now generate the final reply.',
      thinkingExpandable: true,
      thinkingOpenByDefault: false,
    });
    expect(JSON.stringify(response)).not.toContain('Final answer body is streaming');
  });

  it('keeps opaque provider artifacts as non-expandable retained state', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now,
      blocks: [
        {
          id: 'runtime-loop-opaque',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: {
            text: 'Provider state retained.',
            status: 'complete',
            toolCallIds: [],
          },
          thinking: {
            kind: 'opaque',
            source: 'openai-responses-encrypted',
            visibility: 'hidden',
            replayPolicy: 'provider-artifact',
            artifact: { providerId: 'openai', protocol: 'responses', type: 'reasoning', encryptedContent: 'sealed' },
          },
          thinkingStatus: 'complete',
          toolCalls: [],
          startedAt: now,
          completedAt: now + 10,
        },
      ],
    });

    const section = presentation.rows.find((row) => row.type === 'section');
    expect(section).toBeUndefined();
  });

  it('renders raw Anthropic Messages thinking artifacts as collapsed process evidence', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now,
      blocks: [
        {
          id: 'runtime-loop-anthropic-compatible',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: {
            text: 'Turn result.',
            status: 'complete',
            toolCallIds: [],
          },
          thinking: {
            text: 'Provider thought.',
            kind: 'raw',
            source: 'anthropic-thinking',
            visibility: 'raw-collapsed',
            replayPolicy: 'provider-artifact',
            artifact: {
              providerId: 'deepseek',
              modelId: 'deepseek-v4-flash',
              protocol: 'AnthropicMessages',
              type: 'thinking',
              signature: 'sig',
            },
          },
          thinkingStatus: 'complete',
          toolCalls: [],
          startedAt: now,
          completedAt: now + 10,
        },
      ],
    });

    const section = presentation.rows.find((row) => row.type === 'section');
    expect(section).toMatchObject({
      type: 'section',
      resultText: '',
      thinkingLabel: '原始思考',
      thinkingPreview: 'Provider thought.',
      thinkingExpandable: true,
      thinkingOpenByDefault: false,
    });
  });

  it('renders Anthropic-compatible summary thinking without duplicating final answer text', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now,
      blocks: [
        {
          id: 'runtime-loop-anthropic-summary',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: {
            text: 'Turn result.',
            status: 'complete',
            toolCallIds: [],
          },
          thinking: {
            text: 'The user asks in Chinese. Now answer in Chinese.',
            kind: 'summary',
            source: 'anthropic-thinking',
            visibility: 'summary',
            replayPolicy: 'provider-artifact',
            artifact: {
              providerId: 'kimi-coding-plan',
              modelId: 'kimi-for-coding',
              protocol: 'AnthropicMessages',
              type: 'thinking',
              signature: 'sig',
            },
          },
          thinkingStatus: 'complete',
          toolCalls: [],
          startedAt: now,
          completedAt: now + 10,
        },
      ],
    });

    expect(presentation.rows.find((row) => row.type === 'section')).toMatchObject({
      type: 'section',
      resultText: '',
      thinkingLabel: '思考',
      thinkingPreview: 'The user asks in Chinese. Now answer in Chinese.',
      thinkingExpandable: true,
      thinkingOpenByDefault: true,
    });
  });

  it('normalizes stale streaming thinking status after a tool-backed loop completes', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now,
      blocks: [
        {
          id: 'runtime-loop-stale-thinking',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: {
            text: 'Turn result.',
            status: 'complete',
            toolCallIds: ['tool-read'],
          },
          thinking: {
            text: 'Provider thought.',
            kind: 'summary',
            source: 'anthropic-thinking',
            visibility: 'summary',
            replayPolicy: 'provider-artifact',
          },
          thinkingStatus: 'streaming',
          toolCalls: [
            { id: 'tool-read', toolName: 'read_file', status: 'complete', argsPreview: JSON.stringify({ path: 'README.md' }), startedAt: now, completedAt: now + 10 },
          ],
          startedAt: now,
          completedAt: now + 10,
        },
      ],
    });

    const section = presentation.rows.find((row) => row.type === 'section');
    expect(section).toMatchObject({
      type: 'section',
      resultText: 'Turn result.',
      thinkingLabel: '思考',
      thinkingStatus: 'complete',
      thinkingPreview: 'Provider thought.',
      thinkingExpandable: true,
      thinkingOpenByDefault: true,
    });
  });

  it('nests user questions under the model loop that produced them', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'running',
      updatedAt: now,
      blocks: [
        {
          id: 'runtime-loop-ask',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'running',
          result: { text: 'I need a user decision before continuing.', status: 'complete', toolCallIds: [] },
          thinking: {
            text: 'I should ask the user which smoke path to run.',
            kind: 'summary',
            source: 'anthropic-thinking',
            visibility: 'summary',
            replayPolicy: 'provider-artifact',
          },
          thinkingStatus: 'streaming',
          toolCalls: [],
          startedAt: now,
        },
        {
          id: 'tool-ask-user',
          kind: 'user_input',
          title: 'Called ask_user',
          status: 'running',
          toolCalls: [
            {
              id: 'tool-ask',
              toolName: 'ask_user',
              status: 'running',
              argsPreview: JSON.stringify({
                questions: [{
                  questionId: 'smoke-path',
                  prompt: 'Which smoke path should I use?',
                  options: [
                    { optionId: 'read-only', label: 'Read-only smoke' },
                    { optionId: 'edit', label: 'Edit smoke' },
                  ],
                }, {
                  questionId: 'smoke-name',
                  prompt: 'What should I call this smoke run?',
                  options: [],
                }],
              }),
              startedAt: now + 10,
            },
          ],
          startedAt: now + 10,
        },
      ],
    });

    expect(presentation.rows).toHaveLength(1);
    const section = presentation.rows[0];
    expect(section).toMatchObject({
      type: 'section',
      status: 'running',
      stepCount: 1,
      thinkingPreview: 'I should ask the user which smoke path to run.',
    });
    const sectionSteps = section.type === 'section' ? section.steps : [];
    expect(section).toMatchObject({
      type: 'section',
      stepsDisclosure: 'deferred',
    });
    const askGroup = sectionSteps.find((row) => row.type === 'toolGroup' && row.kind === 'interaction');
    expect(askGroup).toMatchObject({
      type: 'toolGroup',
      kind: 'interaction',
      title: '正在询问',
      countLabel: '2 个问题',
      summary: '',
    });
    const visibleAskGroup = flattenVisibleWorkRows(presentation.rows).find((row) => row.type === 'toolGroup' && row.kind === 'interaction');
    expect(visibleAskGroup).toMatchObject({
      type: 'toolGroup',
      rows: [],
      defaultOpen: false,
    });
    expect(flattenVisibleWorkRows(presentation.rows).filter((row) => row.type === 'userInput')).toHaveLength(0);
    const userInputRows = flattenWorkRows(presentation.rows).filter((row) => row.type === 'userInput');
    expect(userInputRows).toHaveLength(1);
    expect(userInputRows[0]).toMatchObject({
      items: [
        { questionId: 'smoke-path', prompt: 'Which smoke path should I use?' },
        { questionId: 'smoke-name', prompt: 'What should I call this smoke run?' },
      ],
    });
  });

  it('renders completed batch ask_user as ordered transcript items without header preview', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now,
      blocks: [
        {
          id: 'tool-ask-user-complete',
          kind: 'user_input',
          title: 'Called ask_user',
          status: 'complete',
          toolCalls: [
            {
              id: 'tool-ask-complete',
              toolName: 'ask_user',
              status: 'complete',
              argsPreview: JSON.stringify({
                questions: [{
                  questionId: 'route',
                  prompt: 'Which route should I use?',
                  options: [
                    { optionId: 'a', label: 'A route' },
                    { optionId: 'b', label: 'B route' },
                  ],
                }, {
                  questionId: 'width',
                  prompt: 'Which viewport should I verify?',
                  options: [],
                }],
              }),
              resultPreview: JSON.stringify({
                answers: [
                  { questionId: 'route', answer: 'A route', selectedOptionId: 'a' },
                  { questionId: 'width', answer: 'narrow\n390x844' },
                ],
              }),
              startedAt: now + 10,
              completedAt: now + 40,
            },
          ],
          startedAt: now + 10,
          completedAt: now + 40,
        },
      ],
    });

    const rows = flattenWorkRows(presentation.rows);
    const askUserGroup = rows.find((row) => row.type === 'toolGroup');
    expect(askUserGroup).toMatchObject({
      type: 'toolGroup',
      title: '已询问',
      countLabel: '2 个问题',
      summary: '',
    });
    const askUserRow = rows.find((row) => row.type === 'userInput');
    expect(askUserRow).toMatchObject({
      type: 'userInput',
      status: 'complete',
      questionCount: 2,
      items: [
        { questionId: 'route', prompt: 'Which route should I use?', answer: 'A route', selectedOptionId: 'a' },
        { questionId: 'width', prompt: 'Which viewport should I verify?', answer: 'narrow\n390x844' },
      ],
    });
  });

  it('keeps failed tool-backed loop thinking as the section top while deduplicating later summary-only echoes', () => {
    const staleSummary = 'Good, file is actually gone. The glob result was likely stale/cached.';
    const presentation = buildWorkProcessPresentation({
      status: 'error',
      updatedAt: now,
      blocks: [
        {
          id: 'runtime-loop-error-tools',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'error',
          result: {
            text: 'Need to verify cleanup state.',
            status: 'complete',
            toolCallIds: ['tool-read-missing'],
          },
          thinking: {
            text: staleSummary,
            kind: 'summary',
            source: 'anthropic-thinking',
            visibility: 'summary',
            replayPolicy: 'provider-artifact',
          },
          thinkingStatus: 'streaming',
          toolCalls: [
            {
              id: 'tool-read-missing',
              toolName: 'read_file',
              status: 'error',
              argsPreview: JSON.stringify({ path: 'missing.txt' }),
              resultPreview: JSON.stringify({ ok: false, error: { message: 'ENOENT' } }),
              startedAt: now,
              completedAt: now + 10,
            },
          ],
          startedAt: now,
          completedAt: now + 10,
        },
        {
          id: 'runtime-loop-summary-duplicate',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { status: 'complete', toolCallIds: [] },
          thinking: {
            text: staleSummary,
            kind: 'summary',
            source: 'anthropic-thinking',
            visibility: 'summary',
            replayPolicy: 'provider-artifact',
          },
          thinkingStatus: 'complete',
          toolCalls: [],
          startedAt: now + 20,
          completedAt: now + 30,
        },
      ],
    });

    const sections = presentation.rows.filter((row) => row.type === 'section');
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({
      type: 'section',
      status: 'error',
      thinkingLabel: '思考',
      thinkingPreview: staleSummary,
      thinkingExpandable: true,
      stepCount: 1,
    });
  });

  it('shows no-thinking loop result before tool execution rows', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'running',
      updatedAt: now,
      blocks: [
        {
          id: 'runtime-loop-tools',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'running',
          result: {
            text: 'I need to inspect the project files.',
            status: 'complete',
            toolCallIds: ['tool-read', 'tool-glob'],
          },
          toolCalls: [
            { id: 'tool-read', toolName: 'read_file', status: 'running', argsPreview: JSON.stringify({ path: 'package.json' }), startedAt: now },
            { id: 'tool-glob', toolName: 'glob', status: 'pending', argsPreview: JSON.stringify({ pattern: 'src/**/*.ts' }), startedAt: now },
          ],
          startedAt: now,
        },
      ],
    });

    const section = presentation.rows.find((row) => row.type === 'section');
    const flatRows = flattenWorkRows(presentation.rows);
    expect(section).toMatchObject({
      type: 'section',
      resultText: 'I need to inspect the project files.',
      resultToolSummary: '',
      thinkingLabel: '',
      thinkingPreview: '',
      thinkingExpandable: false,
      stepCount: 2,
    });
    expect(flatRows.filter((row) => row.type === 'tool')).toHaveLength(2);
  });

  it('defers child tool evidence while visible thinking is streaming', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'running',
      updatedAt: now,
      blocks: [
        {
          id: 'runtime-loop-streaming-tools',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'running',
          result: {
            status: 'complete',
            toolCallIds: ['tool-memory'],
          },
          thinking: {
            text: 'Reading memory before I can answer.',
            kind: 'summary',
            source: 'anthropic-thinking',
            visibility: 'summary',
            replayPolicy: 'provider-artifact',
          },
          thinkingStatus: 'streaming',
          toolCalls: [
            {
              id: 'tool-memory',
              toolName: 'memory_read',
              status: 'complete',
              argsPreview: JSON.stringify({ key: 'project-identity' }),
              resultPreview: JSON.stringify({ ok: true, value: 'RDC Agent' }),
              startedAt: now,
              completedAt: now + 10,
            },
          ],
          startedAt: now,
        },
      ],
    });

    const section = presentation.rows.find((row) => row.type === 'section');
    expect(section).toMatchObject({
      type: 'section',
      status: 'running',
      thinkingStatus: 'streaming',
      stepsDisclosure: 'deferred',
      stepCount: 1,
    });
    expect(flattenWorkRows(presentation.rows).filter((row) => row.type === 'tool')).toHaveLength(1);
    expect(flattenVisibleWorkRows(presentation.rows).filter((row) => row.type === 'tool')).toHaveLength(0);
    const visibleGroup = flattenVisibleWorkRows(presentation.rows).find((row) => row.type === 'toolGroup');
    expect(visibleGroup).toMatchObject({
      type: 'toolGroup',
      defaultOpen: false,
      rows: [],
    });
  });

  it('discloses child tool evidence after visible thinking completes', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now,
      blocks: [
        {
          id: 'runtime-loop-complete-tools',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: {
            status: 'complete',
            toolCallIds: ['tool-memory-complete'],
          },
          thinking: {
            text: 'Read memory and now can answer.',
            kind: 'summary',
            source: 'anthropic-thinking',
            visibility: 'summary',
            replayPolicy: 'provider-artifact',
          },
          thinkingStatus: 'complete',
          toolCalls: [
            {
              id: 'tool-memory-complete',
              toolName: 'memory_read',
              status: 'complete',
              argsPreview: JSON.stringify({ key: 'project-model' }),
              resultPreview: JSON.stringify({ ok: true, value: 'configured model' }),
              startedAt: now,
              completedAt: now + 10,
            },
          ],
          startedAt: now,
          completedAt: now + 10,
        },
      ],
    });

    const section = presentation.rows.find((row) => row.type === 'section');
    expect(section).toMatchObject({
      type: 'section',
      status: 'complete',
      thinkingStatus: 'complete',
      stepsDisclosure: 'visible',
      stepCount: 1,
    });
    expect(flattenVisibleWorkRows(presentation.rows).filter((row) => row.type === 'tool')).toHaveLength(1);
  });
  it('nests tool approval requests under their tool call without leaking internal IDs', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'running',
      updatedAt: now,
      blocks: [
        {
          id: 'runtime-loop-approval',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'running',
          result: {
            status: 'complete',
            toolCallIds: ['tool-web-search'],
          },
          toolCalls: [
            {
              id: 'tool-web-search',
              toolName: 'web_search',
              status: 'running',
              argsPreview: JSON.stringify({ query: 'latest Claude news' }),
              resultPreview: JSON.stringify({ ok: false, error: { message: 'approval required' } }),
              approval: {
                approvalId: 'tool-approval-tool-web-search',
                status: 'pending',
                reason: 'Network tool "web_search" requires approval in the current permission mode.',
                risk: 'medium',
                reviewer: 'auto_review',
              },
              startedAt: now,
            },
          ],
          startedAt: now,
        },
      ],
    });

    const rows = flattenWorkRows(presentation.rows);
    expect(rows.some((item) => item.type === 'approval')).toBe(false);
    const row = rows.find((item) => item.type === 'tool' && item.toolName === 'web_search');
    expect(row).toMatchObject({
      type: 'tool',
      status: 'running',
      verb: '等待审批',
      approval: {
        status: 'pending',
        verb: '自动检查中',
        message: '当前权限模式要求先审批 web_search。',
        metaLines: ['风险：medium', '自动检查'],
      },
      previewLines: [],
      rawLines: [],
    });
    expect(JSON.stringify(row)).not.toContain('toolCallId');
    expect(JSON.stringify(row)).not.toContain('approvalId');
    expect(JSON.stringify(row)).not.toContain('approval required');
  });

  it('keeps read_file previews from ending on an empty-looking lead-in line', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now,
      blocks: [
        {
          id: 'runtime-loop-read',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { status: 'complete', toolCallIds: ['tool-read-capabilities'] },
          toolCalls: [
            {
              id: 'tool-read-capabilities',
              toolName: 'read_file',
              status: 'complete',
              argsPreview: JSON.stringify({ path: 'project-capabilities' }),
              resultPreview: JSON.stringify({
                ok: true,
                data: {
                  content: [{
                    type: 'text',
                    text: [
                      '# project-capabilities',
                      'Core agent capabilities',
                      'Capabilities include:',
                      '- Web search',
                      '- Web fetch',
                    ].join('\n'),
                  }],
                },
              }),
              startedAt: now,
              completedAt: now + 12,
            },
          ],
          startedAt: now,
          completedAt: now + 12,
        },
      ],
    });

    const row = flattenWorkRows(presentation.rows).find((item) => item.type === 'tool' && item.toolName === 'read_file');
    const previewLines = row?.type === 'tool' ? row.previewLines : [];
    expect(previewLines).toEqual([
      '# project-capabilities',
      'Core agent capabilities',
      'Capabilities include:',
      '- Web search',
    ]);
    expect(previewLines.at(-1)).not.toMatch(/[:?]$/);
  });

  it('summarizes web_search structured result details', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now,
      blocks: [
        {
          id: 'runtime-loop-web',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { status: 'complete', toolCallIds: ['tool-web-search'] },
          toolCalls: [
            {
              id: 'tool-web-search',
              toolName: 'web_search',
              status: 'complete',
              argsPreview: JSON.stringify({ query: 'RenderDoc' }),
              resultPreview: JSON.stringify({
                ok: true,
                data: {
                  content: [{ type: 'text', text: 'Search query: RenderDoc' }],
                  details: {
                    kind: 'search',
                    provider: 'DuckDuckGo HTML',
                    resultCount: 1,
                    results: [{ title: 'RenderDoc', url: 'https://renderdoc.org/', snippet: 'Graphics debugger.' }],
                  },
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

    const row = flattenWorkRows(presentation.rows).find((item) => item.type === 'tool' && item.toolName === 'web_search');
    expect(row).toMatchObject({
      type: 'tool',
      verb: '已联网搜索',
    });
    expect(row?.type === 'tool' ? row.previewLines : []).toContain('Provider: DuckDuckGo HTML');
    expect(row?.type === 'tool' ? row.previewLines : []).toContain('https://renderdoc.org/');
  });

  it('groups adjacent file exploration actions with semantic icon and count', () => {
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
    expect(section?.type === 'section' ? section.steps : []).toHaveLength(1);
    expect(section?.type === 'section' ? section.steps[0] : undefined).toMatchObject({
      type: 'toolGroup',
      title: '探索',
      icon: 'file',
      countLabel: '3 文件',
      defaultOpen: true,
    });
    expect(flattenWorkRows(presentation.rows).filter((row) => row.type === 'tool')).toHaveLength(3);
  });

  it('renders dynamic MCP wildcard tools as MCP server/tool groups', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now,
      blocks: [
        {
          id: 'runtime-loop-mcp',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { status: 'complete', toolCallIds: ['tool-mcp'] },
          toolCalls: [
            {
              id: 'tool-mcp',
              toolName: 'mcp__filesystem__read_file',
              status: 'complete',
              argsPreview: JSON.stringify({ path: 'README.md' }),
              resultPreview: JSON.stringify({ ok: true, content: 'readme' }),
              startedAt: now,
              completedAt: now + 10,
            },
          ],
          startedAt: now,
          completedAt: now + 10,
        },
      ],
    });

    expect(flattenWorkRows(presentation.rows).find((row) => row.type === 'toolGroup')).toMatchObject({
      type: 'toolGroup',
      title: 'MCP · filesystem',
      icon: 'plug',
      countLabel: '1 调用',
    });
    expect(flattenWorkRows(presentation.rows).find((row) => row.type === 'tool')).toMatchObject({
      type: 'tool',
      toolName: 'mcp__filesystem__read_file',
      target: 'filesystem/read_file',
      groupKind: 'mcp',
      verb: '已调用 MCP',
    });
  });

  it('gives subagent tool calls collaboration semantics instead of generic fallback', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now,
      blocks: [
        {
          id: 'runtime-loop-subagent',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { status: 'complete', toolCallIds: ['tool-subagent'] },
          toolCalls: [
            {
              id: 'tool-subagent',
              toolName: 'subagent',
              status: 'complete',
              argsPreview: JSON.stringify({ profile: 'reviewer', prompt: 'Review the diff' }),
              resultPreview: JSON.stringify({ summary: 'Reviewed' }),
              startedAt: now,
              completedAt: now + 10,
            },
          ],
          startedAt: now,
          completedAt: now + 10,
        },
      ],
    });

    expect(flattenWorkRows(presentation.rows).find((row) => row.type === 'toolGroup')).toMatchObject({
      type: 'toolGroup',
      title: '协作',
      icon: 'handoff',
      countLabel: '1 子任务',
    });
    expect(flattenWorkRows(presentation.rows).find((row) => row.type === 'tool')).toMatchObject({
      type: 'tool',
      verb: '已调用子代理',
      groupKind: 'collaboration',
    });
  });
});

function makeReadFileLoop(id: string, startedAt: number): ConversationWorkTrace['blocks'][number] {
  return {
    id,
    kind: 'llm_turn',
    title: 'LLM turn',
    status: 'complete',
    result: { status: 'complete', toolCallIds: [`tool-read-${id}`] },
    toolCalls: [{
      id: `tool-read-${id}`,
      toolName: 'read_file',
      status: 'complete',
      argsPreview: JSON.stringify({ path: `${id}.md` }),
      resultPreview: JSON.stringify({ content: 'ok' }),
      startedAt,
      completedAt: startedAt + 10,
    }],
    startedAt,
    completedAt: startedAt + 10,
  };
}

describe('semantic step groups', () => {
  it('maps reasoningState raw/summary to section thinking and opaque/hidden to reasoningIndicator', () => {
    const rawPresentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now,
      blocks: [{
        id: 'loop-raw',
        kind: 'llm_turn',
        title: 'LLM turn',
        status: 'complete',
        reasoningState: 'raw',
        result: { text: 'Done.', status: 'complete', toolCallIds: ['tool-a'] },
        thinking: {
          text: 'raw chain visible',
          kind: 'raw',
          source: 'unknown',
          visibility: 'raw-collapsed',
          replayPolicy: 'none',
        },
        thinkingStatus: 'complete',
        toolCalls: [{
          id: 'tool-a',
          toolName: 'read_file',
          status: 'complete',
          argsPreview: JSON.stringify({ path: 'a.md' }),
          startedAt: now,
          completedAt: now + 5,
        }],
        startedAt: now,
        completedAt: now + 5,
      }],
    });
    const rawSection = rawPresentation.rows.find((row) => row.type === 'section');
    expect(rawSection).toMatchObject({
      type: 'section',
      thinkingLabel: '原始思考',
      thinkingPreview: 'raw chain visible',
    });
    expect(rawPresentation.rows.some((row) => row.type === 'reasoningIndicator')).toBe(false);

    const summaryPresentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now,
      blocks: [{
        id: 'loop-summary',
        kind: 'llm_turn',
        title: 'LLM turn',
        status: 'complete',
        reasoningState: 'summary',
        result: { text: 'Done.', status: 'complete', toolCallIds: [] },
        thinking: {
          text: 'summary visible',
          kind: 'summary',
          source: 'unknown',
          visibility: 'summary',
          replayPolicy: 'none',
        },
        thinkingStatus: 'complete',
        toolCalls: [],
        startedAt: now + 20,
        completedAt: now + 25,
      }],
    });
    const summarySection = summaryPresentation.rows.find((row) => row.type === 'section');
    expect(summarySection).toMatchObject({
      type: 'section',
      thinkingLabel: '思考',
      thinkingPreview: 'summary visible',
    });

    const opaquePresentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now,
      blocks: [{
        id: 'loop-opaque',
        kind: 'llm_turn',
        title: 'LLM turn',
        status: 'complete',
        reasoningState: 'opaque',
        result: { text: 'Retained.', status: 'complete', toolCallIds: [] },
        thinking: {
          kind: 'opaque',
          source: 'openai-responses-encrypted',
          visibility: 'hidden',
          replayPolicy: 'provider-artifact',
        },
        thinkingStatus: 'complete',
        toolCalls: [],
        startedAt: now + 30,
        completedAt: now + 35,
      }],
    });
    expect(opaquePresentation.rows.find((row) => row.type === 'section')).toBeUndefined();
    expect(opaquePresentation.rows.find((row) => row.type === 'reasoningIndicator')).toMatchObject({
      type: 'reasoningIndicator',
      state: 'opaque',
    });

    const hiddenPresentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now,
      blocks: [{
        id: 'loop-hidden',
        kind: 'llm_turn',
        title: 'LLM turn',
        status: 'complete',
        reasoningState: 'hidden',
        result: { text: 'Hidden state.', status: 'complete', toolCallIds: [] },
        toolCalls: [],
        startedAt: now + 40,
        completedAt: now + 45,
      }],
    });
    expect(hiddenPresentation.rows.find((row) => row.type === 'section')).toBeUndefined();
    expect(hiddenPresentation.rows.find((row) => row.type === 'reasoningIndicator')).toMatchObject({
      type: 'reasoningIndicator',
      state: 'hidden',
    });

    const nonePresentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now,
      blocks: [{
        id: 'loop-none',
        kind: 'llm_turn',
        title: 'LLM turn',
        status: 'complete',
        reasoningState: 'none',
        result: { text: 'Tool only.', status: 'complete', toolCallIds: ['tool-none'] },
        toolCalls: [{
          id: 'tool-none',
          toolName: 'read_file',
          status: 'complete',
          argsPreview: JSON.stringify({ path: 'none.md' }),
          startedAt: now + 50,
          completedAt: now + 55,
        }],
        startedAt: now + 50,
        completedAt: now + 55,
      }],
    });
    const noneSection = nonePresentation.rows.find((row) => row.type === 'section');
    expect(noneSection).toMatchObject({
      type: 'section',
      thinkingLabel: '',
      thinkingPreview: '',
      thinkingExpandable: false,
    });
    expect(nonePresentation.rows.some((row) => row.type === 'reasoningIndicator')).toBe(false);
  });

  it('preserves tool call order within a single loop', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now,
      blocks: [{
        id: 'loop-multi-tool',
        kind: 'llm_turn',
        title: 'LLM turn',
        status: 'complete',
        result: { status: 'complete', toolCallIds: ['tool-read', 'tool-glob', 'tool-grep'] },
        toolCalls: [
          { id: 'tool-read', toolName: 'read_file', status: 'complete', argsPreview: JSON.stringify({ path: 'a.ts' }), startedAt: now, completedAt: now + 1 },
          { id: 'tool-glob', toolName: 'glob', status: 'complete', argsPreview: JSON.stringify({ pattern: '*.ts' }), startedAt: now + 2, completedAt: now + 3 },
          { id: 'tool-grep', toolName: 'grep', status: 'complete', argsPreview: JSON.stringify({ pattern: 'foo' }), startedAt: now + 4, completedAt: now + 5 },
        ],
        startedAt: now,
        completedAt: now + 5,
      }],
    });

    const tools = flattenWorkRows(presentation.rows).filter((row) => row.type === 'tool');
    expect(tools.map((row) => row.type === 'tool' ? row.toolName : '')).toEqual(['read_file', 'glob', 'grep']);
    expect(presentation.groups).toHaveLength(1);
    expect(presentation.groups[0].kind).toBe('explore');
  });

  it('merges adjacent loops of the same semantic kind and splits on kind change', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now,
      blocks: [
        makeReadFileLoop('loop-explore-1', now),
        makeReadFileLoop('loop-explore-2', now + 20),
        {
          id: 'loop-web',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { status: 'complete', toolCallIds: ['tool-web'] },
          toolCalls: [{
            id: 'tool-web',
            toolName: 'web_search',
            status: 'complete',
            argsPreview: JSON.stringify({ query: 'RenderDoc' }),
            resultPreview: JSON.stringify({ ok: true }),
            startedAt: now + 40,
            completedAt: now + 50,
          }],
          startedAt: now + 40,
          completedAt: now + 50,
        },
      ],
    });

    expect(presentation.groups).toHaveLength(2);
    expect(presentation.groups[0]).toMatchObject({
      kind: 'explore',
      title: '探索',
      loopIds: ['loop-explore-1', 'loop-explore-2'],
    });
    expect(presentation.groups[1]).toMatchObject({
      kind: 'web',
      title: '联网',
      loopIds: ['loop-web'],
    });
  });

  it('forces approval and ask_user loops into standalone interaction groups', () => {
    const approvalPresentation = buildWorkProcessPresentation({
      status: 'running',
      updatedAt: now,
      blocks: [
        makeReadFileLoop('loop-before-approval', now),
        {
          id: 'loop-approval',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'running',
          result: { status: 'complete', toolCallIds: ['tool-web'] },
          toolCalls: [{
            id: 'tool-web',
            toolName: 'web_search',
            status: 'running',
            argsPreview: JSON.stringify({ query: 'news' }),
            resultPreview: JSON.stringify({ ok: false, error: { message: 'approval required' } }),
            approval: {
              approvalId: 'approval-1',
              status: 'pending',
              reason: 'Network tool "web_search" requires approval in the current permission mode.',
              risk: 'medium',
              reviewer: 'auto_review',
            },
            startedAt: now + 30,
          }],
          startedAt: now + 30,
        },
      ],
    });
    expect(approvalPresentation.groups).toHaveLength(2);
    expect(approvalPresentation.groups[1]).toMatchObject({
      kind: 'interaction',
      title: '交互',
      loopIds: ['loop-approval'],
    });

    const askUserPresentation = buildWorkProcessPresentation({
      status: 'running',
      updatedAt: now,
      blocks: [
        makeReadFileLoop('loop-before-ask', now),
        {
          id: 'loop-ask',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'running',
          result: { status: 'complete', toolCallIds: ['tool-ask'] },
          toolCalls: [{
            id: 'tool-ask',
            toolName: 'ask_user',
            status: 'running',
            argsPreview: JSON.stringify({
              questions: [{
                questionId: 'continue',
                prompt: 'Continue?',
                options: [
                  { optionId: 'yes', label: 'Yes' },
                  { optionId: 'no', label: 'No' },
                ],
              }],
            }),
            startedAt: now + 30,
          }],
          startedAt: now + 30,
        },
      ],
    });
    expect(askUserPresentation.groups).toHaveLength(2);
    expect(askUserPresentation.groups[1]).toMatchObject({
      kind: 'interaction',
      title: '交互',
      loopIds: ['loop-ask'],
    });
    const askGroupRows = askUserPresentation.groups[1].rows;
    expect(askGroupRows.some((row) => row.type === 'section' && row.steps.some((step) => step.type === 'toolGroup' && step.kind === 'interaction'))).toBe(true);
  });

  it('places subagent blocks with children in a standalone collaboration group', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now,
      blocks: [
        makeReadFileLoop('loop-before-subagent', now),
        {
          id: 'block-subagent',
          kind: 'subagent',
          title: 'Sub-agent: reviewer',
          status: 'complete',
          summary: 'Reviewed the diff',
          toolCalls: [],
          children: [makeReadFileLoop('sub-loop-child', now + 30)],
          startedAt: now + 20,
          completedAt: now + 50,
        },
      ],
    });

    expect(presentation.groups).toHaveLength(2);
    const collaborationGroup = presentation.groups[1];
    expect(collaborationGroup).toMatchObject({
      kind: 'collaboration',
      title: '协作',
      loopIds: ['block-subagent'],
    });
    const subagentRow = collaborationGroup.rows.find((row) => row.type === 'subagent');
    expect(subagentRow).toMatchObject({
      type: 'subagent',
      profile: 'reviewer',
      summary: 'Reviewed the diff',
    });
    expect(subagentRow?.type === 'subagent' ? subagentRow.children.length : 0).toBeGreaterThan(0);
  });

  it('places compaction blocks in a standalone compaction group', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now,
      blocks: [
        makeReadFileLoop('loop-before-compaction', now),
        {
          id: 'block-compaction',
          kind: 'compaction',
          title: 'Context compacted',
          status: 'complete',
          summary: 'Compressed 12 turns into working memory',
          toolCalls: [],
          startedAt: now + 20,
          completedAt: now + 30,
        },
      ],
    });

    expect(presentation.groups).toHaveLength(2);
    expect(presentation.groups[1]).toMatchObject({
      kind: 'compaction',
      title: '上下文压缩',
      loopIds: ['block-compaction'],
    });
    expect(presentation.groups[1].rows[0]).toMatchObject({
      type: 'summary',
      text: 'Compressed 12 turns into working memory',
    });
  });

  it('does not create a final response boundary for non-final stop reasons', () => {
    const stopReasons = ['max_tokens', 'refusal', 'aborted'] as const;
    for (const stopReason of stopReasons) {
      const presentation = buildWorkProcessPresentation({
        status: 'complete',
        updatedAt: now,
        blocks: [
          makeReadFileLoop('loop-evidence', now),
          {
            id: `loop-${stopReason}`,
            kind: 'llm_turn',
            title: 'LLM turn',
            status: 'complete',
            result: {
              text: `Truncated output for ${stopReason}`,
              status: 'complete',
              stopReason,
              toolCallIds: [],
            },
            toolCalls: [],
            startedAt: now + 20,
            completedAt: now + 30,
          },
        ],
      });

      expect(presentation.rows.some((row) => row.type === 'response')).toBe(false);
      const section = presentation.rows.find((row) => row.type === 'section' && row.loopId === `loop-${stopReason}`);
      expect(section).toMatchObject({
        type: 'section',
        outputPhase: 'commentary',
        stopReason,
        resultText: `Truncated output for ${stopReason}`,
      });
    }
  });

  it('routes explicit final_answer loops to a response row without duplicating body text in rows', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now,
      blocks: [
        makeReadFileLoop('loop-evidence', now),
        {
          id: 'loop-final',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: {
            text: 'This final answer body must stay in the assistant message.',
            status: 'complete',
            outputPhase: 'final_answer',
            stopReason: 'end_turn',
            toolCallIds: [],
          },
          thinking: {
            text: 'Ready to answer.',
            kind: 'summary',
            source: 'unknown',
            visibility: 'summary',
            replayPolicy: 'none',
          },
          thinkingStatus: 'complete',
          toolCalls: [],
          startedAt: now + 20,
          completedAt: now + 30,
        },
      ],
    });

    const response = presentation.rows.find((row) => row.type === 'response');
    expect(response).toMatchObject({
      type: 'response',
      outputPhase: 'final_answer',
      thinkingPreview: 'Ready to answer.',
    });
    expect(JSON.stringify(presentation.rows)).not.toContain('This final answer body must stay in the assistant message.');
    const responseGroup = presentation.groups.find((group) => group.rows.some((row) => row.type === 'response'));
    expect(responseGroup?.title).toBe('回复');
  });

  it(`splits semantic groups when loop count exceeds ${MAX_LOOPS_PER_GROUP}`, () => {
    const blocks = Array.from({ length: MAX_LOOPS_PER_GROUP + 1 }, (_, index) => (
      makeReadFileLoop(`loop-cap-${index}`, now + index * 10)
    ));
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now,
      blocks,
    });

    const exploreGroups = presentation.groups.filter((group) => group.kind === 'explore');
    expect(exploreGroups).toHaveLength(2);
    expect(exploreGroups[0].loopIds).toHaveLength(MAX_LOOPS_PER_GROUP);
    expect(exploreGroups[1].loopIds).toHaveLength(1);
  });

  it('promotes group-level thinking summary only when later loops have no displayable thinking', () => {
    const promotedPresentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now,
      blocks: [
        {
          id: 'loop-promote-head',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { status: 'complete', toolCallIds: ['tool-promote-1'] },
          thinking: {
            text: 'Stage summary for the whole explore phase.',
            kind: 'summary',
            source: 'unknown',
            visibility: 'summary',
            replayPolicy: 'none',
          },
          thinkingStatus: 'complete',
          toolCalls: [{
            id: 'tool-promote-1',
            toolName: 'read_file',
            status: 'complete',
            argsPreview: JSON.stringify({ path: 'a.md' }),
            startedAt: now,
            completedAt: now + 5,
          }],
          startedAt: now,
          completedAt: now + 5,
        },
        makeReadFileLoop('loop-promote-tail-1', now + 20),
        makeReadFileLoop('loop-promote-tail-2', now + 40),
      ],
    });

    expect(promotedPresentation.groups).toHaveLength(1);
    expect(promotedPresentation.groups[0].groupThinking).toMatchObject({
      preview: 'Stage summary for the whole explore phase.',
      label: '阶段思考摘要',
    });
    const promotedHead = promotedPresentation.groups[0].rows.find((row) => row.type === 'section' && row.loopId === 'loop-promote-head');
    expect(promotedHead).toMatchObject({
      type: 'section',
      thinkingPreview: '',
      thinkingLabel: '',
      thinkingExpandable: false,
    });

    const notPromotedPresentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now,
      blocks: [
        {
          id: 'loop-no-promote-1',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { status: 'complete', toolCallIds: ['tool-np-1'] },
          thinking: {
            text: 'First loop summary.',
            kind: 'summary',
            source: 'unknown',
            visibility: 'summary',
            replayPolicy: 'none',
          },
          thinkingStatus: 'complete',
          toolCalls: [{
            id: 'tool-np-1',
            toolName: 'read_file',
            status: 'complete',
            argsPreview: JSON.stringify({ path: 'first.md' }),
            startedAt: now,
            completedAt: now + 5,
          }],
          startedAt: now,
          completedAt: now + 5,
        },
        {
          id: 'loop-no-promote-2',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { status: 'complete', toolCallIds: ['tool-np-2'] },
          thinking: {
            text: 'Second loop still has visible thinking.',
            kind: 'summary',
            source: 'unknown',
            visibility: 'summary',
            replayPolicy: 'none',
          },
          thinkingStatus: 'complete',
          toolCalls: [{
            id: 'tool-np-2',
            toolName: 'glob',
            status: 'complete',
            argsPreview: JSON.stringify({ pattern: '*.md' }),
            startedAt: now + 20,
            completedAt: now + 25,
          }],
          startedAt: now + 20,
          completedAt: now + 25,
        },
      ],
    });

    expect(notPromotedPresentation.groups[0].groupThinking).toBeUndefined();
    const firstSection = notPromotedPresentation.groups[0].rows.find((row) => row.type === 'section' && row.loopId === 'loop-no-promote-1');
    const secondSection = notPromotedPresentation.groups[0].rows.find((row) => row.type === 'section' && row.loopId === 'loop-no-promote-2');
    expect(firstSection).toMatchObject({
      thinkingPreview: 'First loop summary.',
      thinkingLabel: '思考',
    });
    expect(secondSection).toMatchObject({
      thinkingPreview: 'Second loop still has visible thinking.',
      thinkingLabel: '思考',
    });
  });

  it('produces deterministic presentation depth for identical input', () => {
    const trace: ConversationWorkTrace = {
      status: 'complete',
      updatedAt: now,
      blocks: [
        makeReadFileLoop('loop-det-1', now),
        makeReadFileLoop('loop-det-2', now + 20),
        {
          id: 'loop-det-web',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { status: 'complete', toolCallIds: ['tool-det-web'] },
          toolCalls: [{
            id: 'tool-det-web',
            toolName: 'web_search',
            status: 'complete',
            argsPreview: JSON.stringify({ query: 'test' }),
            startedAt: now + 40,
            completedAt: now + 45,
          }],
          startedAt: now + 40,
          completedAt: now + 45,
        },
      ],
    };

    const first = buildWorkProcessPresentation(trace);
    const second = buildWorkProcessPresentation(trace);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.groups).toHaveLength(second.groups.length);
    expect(flattenWorkRows(first.rows)).toHaveLength(flattenWorkRows(second.rows).length);
  });

  it('renders detail view with one section per loop and empty groups', () => {
    const trace: ConversationWorkTrace = {
      status: 'complete',
      updatedAt: now,
      blocks: [
        makeReadFileLoop('loop-detail-1', now),
        makeReadFileLoop('loop-detail-2', now + 20),
        {
          id: 'loop-detail-web',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { status: 'complete', toolCallIds: ['tool-detail-web'] },
          toolCalls: [{
            id: 'tool-detail-web',
            toolName: 'web_search',
            status: 'complete',
            argsPreview: JSON.stringify({ query: 'detail' }),
            startedAt: now + 40,
            completedAt: now + 45,
          }],
          startedAt: now + 40,
          completedAt: now + 45,
        },
      ],
    };

    const grouped = buildWorkProcessPresentation(trace);
    const detail = buildWorkProcessPresentation(trace, { view: 'detail' });

    expect(grouped.groups.length).toBeGreaterThan(0);
    expect(detail.groups).toEqual([]);
    expect(detail.rows.filter((row) => row.type === 'section')).toHaveLength(3);
    expect(detail.rows.map((row) => row.type === 'section' ? row.loopId : '')).toEqual([
      'loop-detail-1',
      'loop-detail-2',
      'loop-detail-web',
    ]);
  });
});
