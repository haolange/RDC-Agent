import { describe, expect, it } from 'vitest';
import type { ConversationWorkTrace } from '@shared/types/conversation';
import { buildWorkProcessPresentation } from './workProcessPresentation';

const now = 1_700_000_000_000;

function flattenWorkRows(rows: ReturnType<typeof buildWorkProcessPresentation>['rows']): Array<(typeof rows)[number]> {
  return rows.flatMap((row) => {
    if (row.type === 'section') return [row, ...flattenWorkRows(row.steps)];
    if (row.type === 'toolGroup') return [row, ...flattenWorkRows(row.rows)];
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
                question: 'Which smoke path should I use?',
                choices: ['Read-only smoke', 'Edit smoke'],
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
    expect(sectionSteps).toHaveLength(1);
    expect(sectionSteps[0]).toMatchObject({
      type: 'toolGroup',
      kind: 'interaction',
      countLabel: '1 问题',
    });
    expect(flattenWorkRows(presentation.rows).filter((row) => row.type === 'userInput')).toHaveLength(1);
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
