import { expect, it } from 'vitest';
import { localizedTranslator } from '../../i18n/messages';
import { buildWorkProcessPresentation } from './workProcessTracePresentation';
import { toolHeadline } from './workProcessHeadline';
import type { ConversationToolCall, ConversationWorkBlock } from '@shared/types/conversation';
import type { WorkProcessRow } from './workProcessTypes';

const t = localizedTranslator('zh-CN');
const now = 1_700_000_000_000;

const fetchCall = (
  id: string,
  url: string,
  title: string,
  startedAt: number,
  completedAt: number,
): ConversationToolCall => ({
  id,
  toolName: 'web_fetch',
  status: 'complete',
  argsPreview: JSON.stringify({ url }),
  resultPreview: JSON.stringify({
    ok: true,
    data: { content: [], details: { kind: 'fetch', url, status: 200, bytes: 10, title } },
  }),
  startedAt,
  executionStartedAt: startedAt,
  completedAt,
});

const searchCall = (id: string, urls: string[]): ConversationToolCall => ({
  id,
  toolName: 'web_search',
  status: 'complete',
  argsPreview: JSON.stringify({ query: 'vkcube' }),
  resultPreview: JSON.stringify({
    ok: true,
    data: {
      content: [],
      details: {
        kind: 'search',
        query: 'vkcube',
        results: urls.map((url) => ({ url, title: url })),
      },
    },
  }),
  startedAt: now,
  executionStartedAt: now,
  completedAt: now + 5,
});

const turn = (id: string, toolCalls: ConversationToolCall[]): ConversationWorkBlock => ({
  id,
  kind: 'llm_turn',
  title: 'LLM turn',
  status: 'complete',
  startedAt: now,
  completedAt: now + 100,
  result: { status: 'complete', toolCallIds: toolCalls.map((call) => call.id) },
  items: [],
  toolCalls,
});

const flatten = (rows: WorkProcessRow[]): WorkProcessRow[] =>
  rows.flatMap((row) =>
    row.type === 'section' ? flatten(row.visibleSteps) : row.type === 'webGroup' ? [row, ...row.members] : [row],
  );

it('joins reads across steps into one card that spans their whole time, and marks the results they opened', () => {
  const presentation = buildWorkProcessPresentation(
    {
      status: 'complete',
      updatedAt: now + 200,
      blocks: [
        turn('search', [searchCall('s', ['https://www.khronos.org/vulkan/', 'https://example.com/unread'])]),
        turn('read-a', [fetchCall('a', 'https://khronos.org/vulkan', 'Vulkan', now + 10, now + 40)]),
        turn('read-b', [fetchCall('b', 'https://renderdoc.org/docs', 'RenderDoc Docs', now + 50, now + 1_250)]),
      ],
    },
    t,
  );
  const rows = flatten(presentation.rows);
  const group = rows.find((row) => row.type === 'webGroup');
  expect(group?.type === 'webGroup' && group.pages.map((page) => page.domain)).toEqual([
    'khronos.org',
    'renderdoc.org',
  ]);
  expect(group?.type === 'webGroup' && group.duration).toBe('1.2秒');
  const search = rows.find((row) => row.type === 'tool' && row.toolName === 'web_search');
  expect(search?.type === 'tool' && search.webPages?.map((page) => page.read)).toEqual([true, false]);
});

it('titles a card with what was done to what', () => {
  const presentation = buildWorkProcessPresentation(
    {
      status: 'complete',
      updatedAt: now + 50,
      blocks: [
        turn('one', [
          fetchCall('a', 'https://platform.claude.com/models', 'Models overview', now, now + 20),
          searchCall('s', []),
        ]),
      ],
    },
    t,
  );
  const tools = flatten(presentation.rows).filter(
    (row): row is Extract<WorkProcessRow, { type: 'tool' }> => row.type === 'tool',
  );
  expect(tools.map((row) => toolHeadline(row, t))).toEqual([
    '读取 platform.claude.com 的《Models overview》',
    '搜索「vkcube」',
  ]);
});
