import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ConversationWorkTrace } from '@shared/types/conversation';
import { WorkProcess } from './WorkProcess';

vi.mock('../../../i18n', () => ({
  useI18n: () => ({
    language: 'zh-CN',
    t: (key: string, params?: Record<string, string | number>) => {
      if (key === 'chat.workProcessActions') return `${params?.count ?? 0} actions`;
      if (key === 'chat.workProcessDuration') return String(params?.duration ?? '');
      return key;
    },
  }),
}));

vi.mock('./markdownHighlight', () => ({}));
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
      text: '我先查看项目文件，再把身份、模型、工具和这个库的用途一起说明。',
      status: 'complete',
      outputPhase: 'commentary',
      toolCallIds: ['tool-glob'],
    },
    thinking: {
      text: '**Planning project purpose inspection**',
      kind: 'summary',
      source: 'openai-responses-summary',
      visibility: 'summary',
    },
    thinkingStatus: 'complete',
    toolCalls: [{
      id: 'tool-glob',
      toolName: 'glob',
      status: 'complete',
      argsPreview: JSON.stringify({ pattern: '*' }),
      resultPreview: JSON.stringify({ files: ['.rdx/.gitignore'] }),
      startedAt: now + 200,
      completedAt: now + 356,
    }],
    startedAt: now,
    completedAt: now + 1400,
  }],
};

describe('Work Process thinking markdown', () => {
  it('renders GPT summary titles through MessageMarkdown instead of literal **', () => {
    const html = renderToStaticMarkup(createElement(WorkProcess, { trace: gptSummaryTrace }));
    expect(html).toContain('work-process-thinking-preview');
    expect(html).toContain('markdown-body');
    expect(html).toContain('<strong>Planning project purpose inspection</strong>');
    expect(html).not.toContain('**Planning project purpose inspection**');
  });
});
