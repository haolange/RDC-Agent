import { describe, expect, it } from 'vitest';
import type { ConversationWorkTrace } from '@shared/types/conversation';
import { buildWorkProcessPresentation } from './workProcessPresentation';

const now = 1_700_000_000_000;

function flattenWorkRows(rows: ReturnType<typeof buildWorkProcessPresentation>['rows']): Array<(typeof rows)[number]> {
  return rows.flatMap((row) => (row.type === 'section' ? [row, ...flattenWorkRows(row.steps)] : [row]));
}

describe('buildWorkProcessPresentation', () => {
  it('streams a no-thinking loop result directly', () => {
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
    const section = presentation.rows.find((row) => row.type === 'section');

    expect(presentation.defaultExpanded).toBe(true);
    expect(presentation.stepCount).toBe(1);
    expect(presentation.toolCount).toBe(0);
    expect(section).toMatchObject({
      type: 'section',
      status: 'running',
      resultText: 'Inspecting capture metadata',
      resultStreaming: true,
      thinkingLabel: '',
      stepCount: 0,
    });
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

  it('keeps raw thinking folded as evidence above the loop result', () => {
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
      resultToolSummary: 'Requested 1 tool: read_file.',
      thinkingLabel: 'Thought',
      thinkingExpandable: true,
      thinkingOpenByDefault: false,
      thinkingStatus: 'complete',
    });
    expect(section?.type === 'section' ? section.thinkingPreview : '').toContain('raw chain-of-thought');
  });

  it('opens streaming summary thinking while the loop result streams below it', () => {
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
      resultText: 'I found the relevant files.',
      resultStreaming: true,
      thinkingLabel: 'Thinking',
      thinkingOpenByDefault: true,
      thinkingStatus: 'streaming',
    });
  });

  it('marks completed summary thinking as thought and folds it above the result', () => {
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
      resultText: 'Turn result.',
      resultStreaming: false,
      thinkingLabel: 'Thought',
      thinkingExpandable: true,
      thinkingOpenByDefault: false,
      thinkingStatus: 'complete',
    });
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
    expect(section).toMatchObject({
      type: 'section',
      thinkingLabel: 'Provider continuation state retained',
      thinkingExpandable: false,
      thinkingPreview: '',
    });
  });

  it('shows text plus requested tools as the same loop result before tool execution rows', () => {
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
      resultToolSummary: 'Requested 2 tools: read_file, glob.',
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
      verb: 'Waiting for approval',
      approval: {
        status: 'pending',
        verb: 'Auto-reviewing',
        message: 'Current permission mode requires approval before running web_search.',
        metaLines: ['Risk: medium', 'Auto-review'],
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
      verb: 'Searched web',
    });
    expect(row?.type === 'tool' ? row.previewLines : []).toContain('Provider: DuckDuckGo HTML');
    expect(row?.type === 'tool' ? row.previewLines : []).toContain('https://renderdoc.org/');
  });
});
