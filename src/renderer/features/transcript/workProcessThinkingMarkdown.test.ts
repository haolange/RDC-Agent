import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { WorkProcess } from './WorkProcess';
import type { ConversationThinkingItem, ConversationWorkTrace } from '@shared/types/conversation';

vi.mock('../../i18n', () => ({
  useI18n: () => ({
    language: 'zh-CN',
    t: (key: string, params?: Record<string, string | number>) => {
      if (key === 'chat.workProcessActions') return `${params?.count ?? 0} actions`;
      if (key === 'chat.workProcessDuration') return String(params?.duration ?? '');
      return key;
    },
  }),
}));

vi.mock('../../patterns/Markdown/markdownHighlight', () => ({ MARKDOWN_LANGUAGES: {}, MARKDOWN_LANGUAGE_ALIASES: {} }));
vi.mock('katex/dist/katex.min.css', () => ({}));

const now = 1_700_000_000_000;

const gptSummaryTrace: ConversationWorkTrace = {
  status: 'complete',
  updatedAt: now + 1400,
  blocks: [{
    id: 'runtime-loop-1',
    kind: 'llm_turn',
    title: 'LLM turn',
    status: 'complete',
    result: {
      status: 'complete',
      outputPhase: 'commentary',
      toolCallIds: ['tool-glob'],
    },
    items: [
      {
        kind: 'thinking',
        providerOutputRef: { protocol: 'OpenAIResponses', providerBlockKey: 'reasoning', contentIndex: 0 },
        thinking: {
          text: '**Planning project purpose inspection**',
          kind: 'summary',
          source: 'openai-responses-summary',
          visibility: 'summary',
        },
        status: 'complete',
        displayOrder: 1,
      },
      {
        kind: 'text',
        providerOutputRef: { protocol: 'OpenAIResponses', providerBlockKey: 'message', contentIndex: 0 },
        text: '我先查看项目文件，再把身份、模型、工具和这个库的用途一起说明。',
        phase: 'commentary',
        status: 'complete',
        displayOrder: 2,
      },
    ],
    toolCalls: [{
      id: 'tool-glob',
      toolName: 'glob',
      status: 'complete',
      argsPreview: JSON.stringify({ pattern: '*' }),
      resultPreview: JSON.stringify({ files: ['.rdc-agent/.gitignore'] }),
      displayOrder: 3,
      startedAt: now + 200,
      completedAt: now + 356,
    }],
    startedAt: now,
    completedAt: now + 1400,
  }],
};

function renderThinking(text: string, visibility: ConversationThinkingItem['thinking']['visibility'] = 'summary'): string {
  const [block] = gptSummaryTrace.blocks;
  const items = block.items?.map((item) => item.kind === 'thinking'
    ? { ...item, thinking: { ...item.thinking, text, visibility } }
    : item);
  const trace = { ...gptSummaryTrace, blocks: [{ ...block, items }] };
  return renderToStaticMarkup(createElement(WorkProcess, { trace, messageId: 'thinking-markdown' }));
}

describe('Work Process thinking markdown', () => {
  it('renders a GPT summary title inside its disclosure before commentary and its tool', () => {
    const html = renderThinking('**Planning project purpose inspection**');
    const caption = html.indexOf('work-process-thinking-summary');
    const commentary = html.indexOf('我先查看项目文件');
    expect(caption).toBeGreaterThan(-1);
    expect(commentary).toBeGreaterThan(caption);
    expect(html.indexOf('data-testid="work-process-tool-call"')).toBeGreaterThan(commentary);
    expect(html).toContain('<strong>Planning project purpose inspection</strong>');
    expect(html).toContain('work-process-thinking-preview');
    expect(html).not.toContain('**Planning project purpose inspection**');
  });

  it('preserves indented code and hard breaks through the live projection path', () => {
    const html = renderThinking('    if (ready) {\n      inspect();\n    }\n\nFirst line.  \r\nSecond line.');
    expect(html).toMatch(/<code\b[^>]*>if \(ready\) \{\n  inspect\(\);\n\}\n<\/code>/u);
    expect(html).toContain('First line.<br/>\nSecond line.');
  });

  it('keeps a title followed by reference definitions inside the disclosure', () => {
    const html = renderThinking('# Inspect\n\n[ref]: https://example.com');
    expect(html).toContain('work-process-thinking-summary');
    expect(html).toContain('<h1>Inspect</h1>');
    expect(html).toContain('work-process-thinking-preview');
  });

  it.each(['   \n', '[ref]: https://example.com', '## ###'])('omits an empty thinking row for %j', (value) => {
    expect(renderThinking(value)).not.toContain('data-testid="work-process-thinking"');
  });

  it('omits hidden thinking before Markdown rendering', () => {
    expect(renderThinking('# Hidden reasoning', 'hidden')).not.toContain('Hidden reasoning');
  });
});
