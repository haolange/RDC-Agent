// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { DelegationTraceHeader } from '@shared/types/delegationTrace';
import { DelegationTaskDocument } from './DelegationTaskDocument';
import { ScopedWorkDisclosure } from './ScopedWorkDisclosure';
import { SubagentCallDetails } from './SubagentCallDetails';

vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string, values?: { count: number }) =>
  `${key}${values ? `:${values.count}` : ''}` }) }));
vi.mock('../../patterns/Markdown/MessageMarkdown', () => ({ MessageMarkdown: ({ content }: { content: string }) =>
  React.createElement('p', null, content) }));

const taskText = JSON.stringify({ capsule: {
  task: 'Inspect the workspace.', goal: 'Inspect the workspace.', scope: 'Read only.', outputRequirements: 'List names.',
  stopConditions: [], acceptedFacts: [{ statement: 'Root exists.', qualification: '', sourceRefs: [] }],
  hypotheses: [], challengeRefs: [], inputArtifactRefs: [], negativePaths: [], requiredSkillIds: [],
  profile: 'general', budget: { maxToolCalls: 0, maxWallTimeMs: 0, maxSubagents: 0 },
}, completionRequirements: [] });

const header: DelegationTraceHeader = {
  recordVersion: 2, parentToolCallId: 'parent', task: 'Inspect the workspace.', taskLength: 22,
  taskAvailable: true, invocationAvailable: true, parentReceiptAvailable: false, sentPromptAvailable: true,
  profile: 'general', mode: 'wait', executionId: 'execution-long-identifier', generation: 1,
  taskId: 'task-1', childSessionId: 'child', status: 'complete', startedAt: 1, updatedAt: 2,
  total: 0, revision: 1,
};

it('keeps task facts and constraints in separate secondary cards with independent bodies', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const Harness = () => {
    const [factsOpen, setFactsOpen] = React.useState(false);
    const [constraintsOpen, setConstraintsOpen] = React.useState(false);
    return React.createElement(DelegationTaskDocument, { text: taskText, factsOpen, constraintsOpen,
      toggle: fold => fold === 'factsOpen' ? setFactsOpen(value => !value) : setConstraintsOpen(value => !value) });
  };
  try {
    await act(async () => root.render(React.createElement(Harness)));
    const cards = host.querySelectorAll<HTMLElement>('.work-delegation-document > .variant-secondary-card');
    expect(cards).toHaveLength(2);
    expect(host.textContent?.split('Inspect the workspace.')).toHaveLength(2);
    expect(cards[0].querySelector('button')?.getAttribute('aria-expanded')).toBe('false');
    expect(cards[0].textContent).not.toContain('Root exists.');
    expect(cards[1].textContent).toContain('chat.subagentBudgetChildren:0');
    await act(async () => cards[0].querySelector('button')!.click());
    expect(cards[0].querySelector('.work-disclosure-body')?.textContent).toContain('Root exists.');
    expect(cards[1].querySelector('.work-disclosure-body')).toBeNull();
    await act(async () => cards[1].querySelector('button')!.click());
    expect(cards[1].querySelector('.work-disclosure-body')?.textContent).toContain('chat.subagentBudgetChildren:0');
    expect(cards[0].querySelector('.work-disclosure-body')?.textContent).toContain('Root exists.');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('opens each call record on demand and renders unavailable receipt without an action', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const read = vi.fn(async (request: { kind: string }) => ({ text: `raw ${request.kind}`, nextOffset: null, total: 24 }));
  vi.stubGlobal('electronAPI', { conversation: { getDelegationContent: read } });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(React.createElement(ScopedWorkDisclosure, { scope: 'session:parent:details',
      children: React.createElement(SubagentCallDetails, { header, sessionId: 'session', parentToolCallId: 'parent' }),
    })));
    const cards = host.querySelectorAll<HTMLElement>('.work-process-subagent-raw > .variant-secondary-card');
    expect(cards).toHaveLength(4);
    expect(read).not.toHaveBeenCalled();
    expect(cards[1].textContent).toContain('chat.subagentRecordUnavailable');
    expect(cards[1].querySelector('button')).toBeNull();
    await act(async () => cards[0].querySelector('button')!.click());
    expect(cards[0].querySelector('.work-disclosure-body')?.textContent).toContain('raw invocation');
    expect(cards[0].querySelector('.work-process-tool-card-raw-section')).toBeNull();
    expect(cards[2].querySelector('.work-disclosure-body')).toBeNull();
    expect(read.mock.calls.map(([request]) => request.kind)).toEqual(['invocation']);
    await act(async () => cards[2].querySelector('button')!.click());
    expect(cards[2].querySelector('.work-disclosure-body')?.textContent).toContain('raw sent_prompt');
    expect(read.mock.calls.map(([request]) => request.kind)).toEqual(['invocation', 'sent_prompt']);
    await act(async () => cards[3].querySelector('button')!.click());
    expect(cards[3].querySelector('.work-disclosure-body')?.textContent).toContain('execution-long-identifier');
    expect(cards[3].querySelector('.work-disclosure-body button')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
