// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { SubagentRow } from './SubagentRow';
import { useSettingsNavigationStore } from '../../stores/settingsNavigationStore';

const state = vi.hoisted(() => ({ expanded: false, taskLoading: false, taskError: false, headerLoading: false, headerMissing: false,
  configurationError: false, workOpen: false, finalOpen: false, projectedFinal: false }));
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
  expanded: state.expanded, workOpen: state.workOpen, finalOpen: state.finalOpen, detailsOpen: false,
  factsOpen: false, constraintsOpen: false, toggle: () => {}, openCard: () => {},
}) }));
vi.mock('./useDelegationTrace', () => ({ useDelegationTrace: () => ({
  page: { header: state.headerLoading || state.headerMissing ? null : { task, profile: 'general', status: state.configurationError ? 'failed' : 'complete', mode: 'wait', startedAt: 1,
    ...(state.configurationError ? { configurationError: 'MODEL_UNAVAILABLE', error: 'Model unavailable' } : {}),
    completedAt: 1000, taskAvailable: true, finalAvailable: state.projectedFinal },
    steps: state.projectedFinal ? [{ id: 'loop', revision: 1, block: { id: 'loop', kind: 'llm_turn', title: 'Loop',
      status: 'complete', startedAt: 1, toolCalls: [], outputItems: [{ providerOutputRef: {
        protocol: 'test', providerBlockKey: 'text', contentIndex: 0 }, text: 'Final child reply',
        phase: 'final_answer', status: 'complete', displayOrder: 1 }] } }] : [], total: state.projectedFinal ? 1 : 0, revision: 1 },
  loading: false, headerLoading: state.headerLoading, hasEarlier: false, loadEarlier: async () => {}, retry: () => {},
}) }));
vi.mock('./useDelegationContent', () => ({ useDelegationContent: (input: { kind: string; available: boolean }) => ({
  text: input.available && input.kind === 'final' ? 'Final child reply'
    : input.available && input.kind === 'task' && !state.taskLoading && !state.taskError ? body : '',
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

it('shows a child final once while preserving both disclosure controls', () => {
  state.expanded = true; state.workOpen = true; state.finalOpen = true; state.projectedFinal = true;
  try {
    const open = new DOMParser().parseFromString(renderToStaticMarkup(createElement(SubagentRow, { row, sessionId: 's1' })), 'text/html');
    expect(open.body.textContent?.split('Final child reply')).toHaveLength(2);
    expect(open.body.textContent).toContain('chat.subagentFinalShownAbove');
    state.workOpen = false;
    const folded = new DOMParser().parseFromString(renderToStaticMarkup(createElement(SubagentRow, { row, sessionId: 's1' })), 'text/html');
    expect(folded.body.textContent?.split('Final child reply')).toHaveLength(2);
    expect(folded.body.textContent).not.toContain('chat.subagentFinalShownAbove');
  } finally { state.expanded = false; state.workOpen = false; state.finalOpen = false; state.projectedFinal = false; }
});

it('offers the exact Agent settings for trusted configuration failures', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  state.expanded = true;
  state.configurationError = true;
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(SubagentRow, { row, sessionId: 'config' })));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Model unavailable');
    const button = [...host.querySelectorAll('button')].find((element) => element.textContent === 'chat.subagentOpenAgentSettings');
    expect(button).toBeDefined();
    await act(async () => button!.click());
    expect(useSettingsNavigationStore.getState().agentRequest?.agentId).toBe('general');
    state.configurationError = false;
    await act(async () => root.render(createElement(SubagentRow, { row, sessionId: 'config' })));
    expect([...host.querySelectorAll('button')].some((element) => element.textContent === 'chat.subagentOpenAgentSettings')).toBe(false);
  } finally {
    await act(async () => root.unmount()); host.remove();
    useSettingsNavigationStore.getState().clearAgentRequest(); vi.unstubAllGlobals();
    state.expanded = false; state.configurationError = false;
  }
});

it('shows the parent receipt and task when admission fails before a child trace exists', () => {
  state.expanded = true;
  state.headerMissing = true;
  const failedRow = { ...row, status: 'error' as const, resultPreview: 'SUBAGENT_BUDGET: child wall time exceeded' };
  try {
    const opened = new DOMParser().parseFromString(renderToStaticMarkup(createElement(SubagentRow, { row: failedRow, sessionId: 's1' })), 'text/html');
    expect(opened.querySelector('.work-process-subagent-receipt-error[role="alert"]')?.textContent).toContain('SUBAGENT_BUDGET');
    expect(opened.querySelector('.work-process-subagent-task')?.textContent).toContain(task);
    expect(opened.querySelector('.work-process-subagent-task')?.textContent).not.toContain('chat.subagentContentUnavailable');
  } finally {
    state.headerMissing = false;
    state.expanded = false;
  }
});
