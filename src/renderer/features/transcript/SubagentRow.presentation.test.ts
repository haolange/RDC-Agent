// @vitest-environment happy-dom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { SubagentRow } from './SubagentRow';

const state = vi.hoisted(() => ({ expanded: false, taskLoading: false, taskError: false, headerLoading: false }));
const task = 'Use glob to inspect the project root.';
const body = JSON.stringify({ capsule: {
  task, goal: task, scope: '', outputRequirements: '', stopConditions: [], acceptedFacts: [], hypotheses: [],
  challengeRefs: [], inputArtifactRefs: [], negativePaths: [], requiredSkillIds: [], profile: 'general',
  budget: { maxToolCalls: 0, maxWallTimeMs: 0, maxSubagents: 0 },
}, completionRequirements: [] });

vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('../../patterns/Markdown/MessageMarkdown', () => ({ MessageMarkdown: ({ content }: { content: string }) => createElement('p', null, content) }));
vi.mock('../../stores/appSettingsStore', () => ({ useAppSettingsStore: (selector: (state: unknown) => unknown) =>
  selector({ settings: { agents: { definitions: [] } } }) }));
vi.mock('./useSubagentDisclosure', () => ({ useSubagentDisclosure: () => ({
  expanded: state.expanded, workOpen: false, finalOpen: false, detailsOpen: false,
  factsOpen: false, constraintsOpen: false, toggle: () => {}, openCard: () => {},
}) }));
vi.mock('./useDelegationTrace', () => ({ useDelegationTrace: () => ({
  page: { header: state.headerLoading ? null : { task, profile: 'general', status: 'complete', mode: 'wait', startedAt: 1,
    completedAt: 1000, taskAvailable: true }, steps: [], total: 0, revision: 1 },
  loading: false, headerLoading: state.headerLoading, hasEarlier: false, loadEarlier: async () => {}, retry: () => {},
}) }));
vi.mock('./useDelegationContent', () => ({ useDelegationContent: (input: { kind: string; available: boolean }) => ({
  text: input.available && input.kind === 'task' && !state.taskLoading && !state.taskError ? body : '',
  hasMore: false, loading: state.taskLoading, error: state.taskError,
  loadMore: async () => {}, retry: () => {},
}) }));

const row = { type: 'subagent' as const, id: 'delegation-1', status: 'complete' as const,
  profile: 'general', task, mode: 'wait' as const, argsPreview: '', resultPreview: '', duration: '1s' };

it('presents the frozen task once in each card state and unmounts the preview on expansion', () => {
  state.expanded = false;
  const collapsed = new DOMParser().parseFromString(renderToStaticMarkup(createElement(SubagentRow, { row, sessionId: 's1' })), 'text/html');
  expect(collapsed.querySelector('.work-card-preview')?.textContent).toBe(task);
  expect(collapsed.querySelector('.work-card-preview-trailing .work-process-subagent-dots')).not.toBeNull();
  expect(collapsed.querySelectorAll('.work-process-subagent-dots > span')).toHaveLength(24);
  expect(collapsed.querySelector('.work-process-subagent-dots.is-complete')).not.toBeNull();
  expect(collapsed.querySelector('.work-process-tool-card-header .work-process-subagent-dots')).toBeNull();
  expect(collapsed.querySelector('.work-process-subagent-task')).toBeNull();
  expect(collapsed.body.textContent?.split(task)).toHaveLength(2);

  state.expanded = true;
  const opened = new DOMParser().parseFromString(renderToStaticMarkup(createElement(SubagentRow, { row, sessionId: 's1' })), 'text/html');
  expect(opened.querySelector('.work-card-preview')).toBeNull();
  expect(opened.querySelector('.work-process-subagent-task')?.textContent).toContain(task);
  expect(opened.body.textContent?.split(task)).toHaveLength(2);
  expect(opened.querySelector('.work-process-subagent-dots')).toBeNull();
  expect(opened.querySelector('.work-process-subagent-task-document')?.textContent).toContain(task);

  state.taskLoading = true;
  const loading = new DOMParser().parseFromString(renderToStaticMarkup(createElement(SubagentRow, { row, sessionId: 's1' })), 'text/html');
  expect(loading.querySelector('.work-card-preview')).toBeNull();
  expect(loading.querySelector('.work-process-subagent-task')?.textContent).toContain('chat.subagentLoading');
  expect(loading.body.textContent).not.toContain(task);

  state.taskLoading = false;
  state.taskError = true;
  const failed = new DOMParser().parseFromString(renderToStaticMarkup(createElement(SubagentRow, { row, sessionId: 's1' })), 'text/html');
  expect(failed.querySelector('.work-card-preview')).toBeNull();
  expect(failed.querySelector('.work-process-subagent-task')?.textContent).toContain('chat.subagentRetry');
  expect(failed.body.textContent).not.toContain(task);
  state.taskError = false;

  state.headerLoading = true;
  const pending = new DOMParser().parseFromString(renderToStaticMarkup(createElement(SubagentRow, { row, sessionId: 's1' })), 'text/html');
  expect(pending.querySelector('.work-card-preview')).toBeNull();
  expect(pending.querySelector('.work-process-subagent-task')?.textContent).toContain('chat.subagentLoading');
  expect(pending.body.textContent).not.toContain(task);
  expect(pending.body.textContent).not.toContain('chat.subagentNoActions');
  expect(pending.body.textContent).not.toContain('chat.subagentNoFinal');
  state.headerLoading = false;
});
