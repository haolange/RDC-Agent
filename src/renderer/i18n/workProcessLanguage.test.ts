// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { AppLanguage } from '@shared/types/settings';
import type { ConversationToolCall, ConversationWorkTrace } from '@shared/types/conversation';
import { BUILTIN_AGENT_TOOL_IDS } from '@shared/constants/agentToolTokens';
import { translate, type Translator } from './messages';
import { createToolRowForPresentation, getToolVerb } from '../features/transcript/workProcessToolRows';
import { buildToolAggregateSummary } from '../features/transcript/workProcessToolAggregate';
import { buildWorkProcessPresentation } from '../features/transcript/workProcessTracePresentation';
import { WorkProcess } from '../features/transcript/WorkProcess';
import { useAppSettingsStore } from '../stores/appSettingsStore';
import { localizeCommands } from '../lib/commandLabels';

const translator = (language: AppLanguage): Translator => (key, params) => translate(language, key, params);
const call = (toolName: string, status: ConversationToolCall['status'] = 'complete'): ConversationToolCall => ({
  id: toolName, toolName, status, startedAt: 1, executionStartedAt: status === 'pending' ? undefined : 1,
  completedAt: status === 'running' || status === 'pending' ? undefined : 100,
  argsPreview: '{"path":"中文文件.txt"}', resultPreview: '原始中文 output',
});

afterEach(() => vi.unstubAllGlobals());

it('covers every builtin and terminal state in both languages without translating original content', () => {
  for (const language of ['en', 'zh-CN'] as const) {
    const t = translator(language);
    for (const name of [...BUILTIN_AGENT_TOOL_IDS, 'mcp__server__tool', 'unknown_tool']) {
      for (const status of ['pending', 'running', 'complete', 'error', 'skipped', 'cancelled'] as const) {
        const row = createToolRowForPresentation(call(name, status), t);
        if (row.type !== 'tool' && row.type !== 'userInput') throw new Error('expected visible tool');
        expect(row.verb).toBeTruthy();
        expect(row.verb).not.toContain('chat.');
        if (language === 'en') expect(row.verb).not.toMatch(/\p{Script=Han}/u);
        else expect(row.verb).toMatch(/\p{Script=Han}/u);
        if (row.type === 'tool') {
          expect(row.toolName).toBe(name);
          expect(row.rawLines.join('\n')).toContain('原始中文 output');
          expect(row.target).toBe(name.startsWith('mcp__') ? 'server/tool' : '中文文件.txt');
        }
      }
    }
  }
  expect(getToolVerb('artifact_read', 'complete', undefined, undefined, translator('en'))).toBe('Read artifact');
  expect(getToolVerb('artifact_read', 'complete', undefined, undefined, translator('zh-CN'))).toBe('已读取产物');
});

it('translates approvals, unknown risks and fallback messages while retaining host reasons', () => {
  for (const language of ['en', 'zh-CN'] as const) {
    for (const status of ['pending', 'approved', 'rejected', 'cancelled'] as const) {
      for (const reviewMethod of ['rule', 'model', undefined] as const) {
        const t = translator(language);
        const row = createToolRowForPresentation({ ...call('shell', 'pending'),
          approval: { approvalId: 'approval', status, reviewMethod, reviewer: reviewMethod ? 'auto_review' : 'user', risk: 'high', reason: '原始审核 reason' },
        }, t);
        if (row.type !== 'tool' || !row.approval) throw new Error('expected approval');
        expect(row.approval.metaLines).toContain(t('chat.workProcessRiskHigh'));
        if (language === 'en') expect(row.approval.verb).not.toMatch(/\p{Script=Han}/u);
        if (status !== 'approved') expect(row.approval.message).toBe('原始审核 reason');
      }
    }
    const row = createToolRowForPresentation({ ...call('shell'), approval: {
      approvalId: 'unknown-risk', status: 'rejected', risk: 'custom-risk',
    } }, translator(language));
    if (row.type !== 'tool' || !row.approval) throw new Error('expected approval');
    expect(row.approval.metaLines[0]).toContain('custom-risk');
    expect(row.approval.message).toBe(translate(language, 'chat.approvalRejectedMessage'));
  }
});

it('formats mixed aggregate counts and compaction details directly for the selected language', () => {
  const tools = ['read_file', 'read_file', 'write_file', 'shell'].map(name => createToolRowForPresentation(call(name), translator('en')))
    .filter((row): row is Extract<typeof row, { type: 'tool' }> => row.type === 'tool');
  expect(buildToolAggregateSummary(tools, translator('en'))).toBe('Created 1 file, Read 2 files, Ran 1 command');
  expect(buildToolAggregateSummary(tools, translator('zh-CN'))).toBe('创建了 1 个文件，读取了 2 个文件，运行了 1 条命令');
  const trace: ConversationWorkTrace = { status: 'complete', updatedAt: 2, blocks: [{
    id: 'compact', kind: 'compaction', startedAt: 1, title: '原始标题', summary: '原始压缩内容', status: 'complete', toolCalls: [],
    compactionStats: { provenance: 'auto', messagesBefore: 8, messagesAfter: 2, tokensBefore: 100, tokensAfter: 20 },
  }] };
  const row = buildWorkProcessPresentation(trace, translator('zh-CN')).rows[0];
  if (row.type !== 'summary') throw new Error('expected compaction');
  expect(row.detailLines).toEqual(['原始压缩内容', '8 → 2 条消息', '预估 tokens：100 → 20']);
});

it('updates an already mounted historical tool without losing disclosure or focus or executing IPC', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const ipc = vi.fn();
  vi.stubGlobal('electronAPI', ipc);
  const initial = useAppSettingsStore.getState().settings;
  const trace: ConversationWorkTrace = { status: 'complete', updatedAt: 100, blocks: [{
    id: 'loop', kind: 'llm_turn', title: 'LLM turn', status: 'complete', toolCalls: [call('artifact_read')],
    startedAt: 1, completedAt: 100,
  }] };
  const before = JSON.stringify(trace);
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const switchTo = (language: AppLanguage) => act(async () => {
    useAppSettingsStore.setState({ settings: { ...initial, appearance: { ...initial.appearance, language } } });
  });
  try {
    await switchTo('zh-CN');
    await act(async () => root.render(createElement(WorkProcess, { trace, sessionId: 'language-test', messageId: 'history' })));
    const trigger = host.querySelector<HTMLButtonElement>('.work-card-trigger')!;
    expect(trigger.textContent).toContain('已读取产物');
    await act(async () => { trigger.focus(); trigger.click(); });
    for (const [language, title] of [['en', 'Read artifact'], ['zh-CN', '已读取产物']] as const) {
      await switchTo(language);
      expect(host.querySelector('.work-card-trigger')).toBe(trigger);
      expect(trigger.textContent).toContain(title);
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
      expect(document.activeElement).toBe(trigger);
      expect(host.textContent).toContain('原始中文 output');
    }
    expect(JSON.stringify(trace)).toBe(before);
    expect(ipc).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount()); host.remove();
    useAppSettingsStore.setState({ settings: initial });
  }
});

it('localizes builtin command descriptions without replacing custom descriptions or command identities', () => {
  const commands = [{ id: 'help', name: 'help', description: 'original', category: 'system', aliases: ['?'] },
    { id: 'custom', name: 'custom', description: '用户说明', category: 'custom', aliases: [] }];
  const localized = localizeCommands(commands, translator('zh-CN'));
  expect(localized[0].description).toBe('列出可用命令或查看命令详情');
  expect(localized[0].name).toBe('help');
  expect(localized[1]).toEqual(commands[1]);
  expect(commands[0].description).toBe('original');
});

it('interpolates once without treating parameter content as another translation template', () => {
  const text = translate('en', 'chat.workProcessAskCount', { verb: 'Original {count}', count: 2 });
  expect(text).toContain('Original {count}');
  expect(text).toContain('2');
});
