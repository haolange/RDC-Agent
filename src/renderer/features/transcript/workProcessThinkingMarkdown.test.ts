import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { WorkProcess } from './WorkProcess';
import type { ConversationWorkTrace } from '@shared/types/conversation';

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

vi.mock('../../patterns/Markdown/markdownHighlight', () => ({}));
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

describe('Work Process thinking markdown', () => {
  it('renders GPT summary titles through MessageMarkdown instead of literal **', () => {
    const html = renderToStaticMarkup(createElement(WorkProcess, { trace: gptSummaryTrace, messageId: 'thinking-markdown' }));
    expect(html).toContain('work-process-thinking-preview');
    expect(html).toContain('markdown-body');
    expect(html).toContain('<strong>Planning project purpose inspection</strong>');
    expect(html).not.toContain('**Planning project purpose inspection**');
  });
});
