// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { WorkCardHeader } from './WorkCardHeader';
import { WorkDisclosure } from './WorkDisclosure';
import { DelegationTaskDocument } from './DelegationTaskDocument';
import { CardBody, RawPanel, type ToolRowModel } from './WorkProcessToolCardParts';
import { ToolRow } from './WorkProcessRowParts';
import { DiagnosticRow } from './WorkProcessRows';
import { ScopedWorkDisclosure } from './ScopedWorkDisclosure';
import { WorkProcessContent } from './WorkProcessContent';
import { buildWorkProcessPresentation } from './workProcessTracePresentation';

vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string, values?: { count: number }) => `${key}${values ? `:${values.count}` : ''}` }) }));
vi.mock('../../patterns/Markdown/MessageMarkdown', () => ({ MessageMarkdown: ({ content }: { content: string }) => createElement('p', null, content) }));

const documentText = JSON.stringify({ capsule: {
  task: 'Original task', goal: 'Original task', scope: 'Read only', outputRequirements: 'Original output',
  stopConditions: ['Original stop'], acceptedFacts: [{ statement: 'Original fact', qualification: 'Qualified', sourceRefs: ['source'] }],
  hypotheses: ['Hypothesis'], challengeRefs: ['challenge'], inputArtifactRefs: ['input'],
  negativePaths: [{ path: 'Exclude write', reason: 'Immutable', applicableWhen: 'Always', recheckWhen: 'Never' }],
  requiredSkillIds: ['skill'], profile: 'general', model: 'model', reasoningLevel: 'low', domainExtensions: {},
  budget: { maxToolCalls: 0, maxWallTimeMs: 0, maxSubagents: 0 },
}, completionRequirements: ['deliverable'] });

it('uses one button for identity and preview with metadata before the preview', () => {
  const html = renderToStaticMarkup(createElement(WorkCardHeader, { icon: createElement('span', null, 'icon'), title: 'General',
    status: 'complete', duration: '14s', expanded: false, onClick: () => {}, preview: 'original task' }));
  expect(html.match(/<button/g)).toHaveLength(1);
  expect(html).toContain('aria-expanded="false"');
  expect(html.indexOf('14s')).toBeLessThan(html.indexOf('original task'));
});

it('places progress after the faded task preview below the header divider', () => {
  const render = (expanded: boolean) => new DOMParser().parseFromString(renderToStaticMarkup(createElement(WorkCardHeader, {
    icon: createElement('span', null, 'icon'), title: 'General', status: 'complete', duration: '14s', expanded,
    onClick: () => {}, preview: expanded ? undefined : 'Original task',
    trailingPreview: createElement('span', { className: 'work-process-subagent-dots' }, 'dots'),
  })), 'text/html');
  const collapsed = render(false);
  const opened = render(true);
  expect(collapsed.querySelector('.work-card-preview')?.textContent).toBe('Original taskdots');
  expect(collapsed.querySelector('.work-process-tool-card-header .work-process-subagent-dots')).toBeNull();
  expect(collapsed.querySelector('.work-card-preview > .work-card-preview-trailing .work-process-subagent-dots')).not.toBeNull();
  expect(collapsed.querySelector('.work-card-trigger')?.classList.contains('has-preview')).toBe(true);
  expect(opened.querySelector('.work-card-preview')).toBeNull();
  expect(opened.querySelector('.work-process-subagent-dots')).toBeNull();
  expect(opened.querySelectorAll('.work-card-trigger')).toHaveLength(1);
});

it('unmounts closed content, hides opened preview and removes unavailable actions', () => {
  const render = (open: boolean, disabled = false) => renderToStaticMarkup(createElement(WorkDisclosure, { title: 'Final', preview: 'preview',
    open, disabled, onToggle: () => {}, children: 'complete original reply' }));
  expect(render(false)).not.toContain('complete original reply');
  expect(render(true)).not.toContain('>preview<');
  expect(render(true)).toContain('complete original reply');
  expect(render(false, true)).not.toContain('<button');
});

it('keeps original fields reachable while hiding secondary groups initially and preserving zero budgets', () => {
  const render = (open: boolean) => renderToStaticMarkup(createElement(DelegationTaskDocument, { text: documentText,
    factsOpen: open, constraintsOpen: open, toggle: () => {} }));
  const closed = render(false);
  expect(closed).toContain('Original output');
  expect(closed).not.toContain('Original fact');
  expect(closed).not.toContain('Exclude write');
  expect(closed.match(/Original task/g)).toHaveLength(1);
  expect(closed).toContain('chat.subagentBudgetChildren:0');
  const opened = render(true);
  for (const text of ['Original fact', 'Qualified', 'source', 'Hypothesis', 'challenge', 'input', 'Exclude write', 'Immutable', 'Always', 'Never', 'skill', 'model', 'low', 'deliverable']) {
    expect(opened).toContain(text);
  }
  expect(opened).not.toContain('chat.subagentFieldDomain');
  const document = new DOMParser().parseFromString(opened, 'text/html');
  expect(document.querySelectorAll('.work-document-surface')).toHaveLength(0);
  expect(document.querySelector('.work-process-subagent-task-document')?.textContent).toContain('Original output');
  expect(document.querySelector('.work-process-subagent-task-document')?.textContent).not.toContain('Original fact');
  expect(document.querySelectorAll('.work-delegation-document > .work-disclosure')).toHaveLength(2);
  expect(document.querySelectorAll('.work-delegation-document > .work-disclosure.variant-secondary-card')).toHaveLength(2);
  expect(document.querySelectorAll('.work-delegation-document > .work-disclosure.variant-secondary-card > .work-disclosure-header')).toHaveLength(2);
  expect(document.querySelectorAll('.work-delegation-document > .work-disclosure.variant-secondary-card > .work-disclosure-body')).toHaveLength(2);
});

it('shows exact duplicate summary/output only once without dropping distinct output or raw receipts', () => {
  const row: ToolRowModel = { type: 'tool', id: 'complete', status: 'complete', verb: 'Completed', category: 'task',
    icon: 'turnComplete', groupKind: 'task', family: 'generic', toolName: 'turn_complete', target: '', duration: '25ms',
    argsLines: [], previewLines: ['Completion recorded.'], rawLines: ['Completion recorded.'],
    bodyText: 'Completion recorded.', bodyLines: ['Completion recorded.'] };
  const render = (value: ToolRowModel) => new DOMParser().parseFromString(renderToStaticMarkup(createElement(CardBody, { row: value })), 'text/html').body.textContent;
  expect(render(row)).toBe('Completion recorded.');
  expect(render({ ...row, bodyLines: ['Completion recorded.', 'Warning retained.'] })).toContain('Warning retained.');
  expect(render({ ...row, bodyLines: ['Completion recorded!'] })).toContain('Completion recorded!');
  expect(renderToStaticMarkup(createElement(RawPanel, { row }))).toContain('Completion recorded.');
  expect(row.rawLines).toEqual(['Completion recorded.']);
});

it('uses one semantic tool card for normal, compact and background wait densities', () => {
  const row: ToolRowModel = { type: 'tool', id: 'inline', status: 'complete', verb: 'Wait ended', category: 'task',
    icon: 'backgroundWait', groupKind: 'task', family: 'generic', toolName: 'background_wait', target: '', duration: '5s',
    argsLines: ['executionId: e1'], previewLines: [], rawLines: ['completed'], bodyText: 'completed', bodyLines: [] };
  const normal = new DOMParser().parseFromString(renderToStaticMarkup(createElement(ToolRow, {
    row: { ...row, toolName: 'turn_complete' }, density: 'normal',
  })), 'text/html');
  const compact = new DOMParser().parseFromString(renderToStaticMarkup(createElement(ToolRow, {
    row: { ...row, toolName: 'turn_complete' }, density: 'compact',
  })), 'text/html');
  const wait = new DOMParser().parseFromString(renderToStaticMarkup(createElement(ToolRow, { row })), 'text/html');
  for (const document of [normal, compact, wait]) {
    expect(document.querySelectorAll('.work-process-tool-card')).toHaveLength(1);
    expect(document.querySelectorAll('.work-card-trigger')).toHaveLength(1);
    expect(document.querySelector('.work-card-trigger')?.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.work-process-tool-inline')).toBeNull();
  }
  expect(normal.querySelector('.work-process-tool-card')?.classList.contains('is-compact')).toBe(false);
  expect(compact.querySelector('.work-process-tool-card')?.classList.contains('is-compact')).toBe(true);
  expect(normal.querySelector('.work-process-tool-card')?.textContent).toBe(compact.querySelector('.work-process-tool-card')?.textContent);
  expect(wait.querySelector('.work-process-tool-card')?.classList.contains('is-compact')).toBe(true);
  expect(wait.querySelector('.work-process-tool-card')?.classList.contains('is-background-wait')).toBe(true);
  expect(wait.querySelector('.work-process-tool-card-body')).toBeNull();
});

it('keeps one event sequence and wording across process densities without inventing commentary', () => {
  const now = 1_700_000_000_000;
  const presentation = buildWorkProcessPresentation({ status: 'complete', updatedAt: now + 400,
    blocks: [
      { id: 'first-turn', kind: 'llm_turn', title: 'LLM turn', status: 'complete',
        result: { text: '', status: 'complete', toolCallIds: ['glob', 'shell'], outputPhase: 'commentary' },
        toolCalls: [
          { id: 'glob', toolName: 'glob', status: 'complete', argsPreview: '{"pattern":"*"}',
            resultPreview: '0 files', startedAt: now + 10, completedAt: now + 20 },
          { id: 'shell', toolName: 'shell.command', status: 'complete', argsPreview: 'Get-ChildItem',
            resultPreview: 'completed', startedAt: now + 30, completedAt: now + 40 },
        ], startedAt: now, completedAt: now + 40 },
      { id: 'diagnostic-hook.completed', kind: 'diagnostic', title: 'Runtime diagnostic', summary: 'Hook rdc-shell-audit: completed',
        diagnosticSeverity: 'info', status: 'complete', toolCalls: [], startedAt: now + 41, completedAt: now + 42 },
      { id: 'second-turn', kind: 'llm_turn', title: 'LLM turn', status: 'complete',
        result: { text: '', status: 'complete', toolCallIds: ['done'], outputPhase: 'commentary' },
        thinking: { kind: 'summary', source: 'anthropic-thinking', visibility: 'summary', text: 'Checked the result.' },
        thinkingStatus: 'complete',
        toolCalls: [{ id: 'done', toolName: 'turn_complete', status: 'complete', argsPreview: '{}',
          resultPreview: 'Turn completion recorded: completed.', startedAt: now + 220, completedAt: now + 245 }],
        startedAt: now + 200, completedAt: now + 245 },
    ] });
  const render = (density: 'normal' | 'compact') => new DOMParser().parseFromString(renderToStaticMarkup(createElement(
    WorkProcessContent, { presentation, density, embedded: density === 'compact' })), 'text/html');
  const normal = render('normal');
  const compact = render('compact');
  for (const document of [normal, compact]) {
    expect([...document.querySelectorAll('[data-testid="work-process-tool-card"]')]).toHaveLength(3);
    expect([...document.querySelectorAll('.work-process-tool-card-header')]).toHaveLength(4);
    expect([...document.querySelectorAll('.work-process-tool-card-body')]).toHaveLength(3);
    expect(document.querySelector('[data-testid="work-process-hook-diagnostic-card"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="work-process-hook-diagnostic-card"]')?.textContent)
      .not.toContain('Hook rdc-shell-audit: completed');
    expect(document.querySelector('.work-process-thinking-summary')?.textContent).toContain('workProcessThoughtFor');
    expect([...document.querySelectorAll('.work-process-prose')]).toHaveLength(0);
  }
  expect(normal.querySelector('.work-process-steps')?.textContent).toBe(compact.querySelector('.work-process-steps')?.textContent);
  expect([...compact.querySelectorAll('[data-testid="work-process-tool-card"]')].map((card) => card.closest('li')?.getAttribute('data-testid')))
    .toEqual([...normal.querySelectorAll('[data-testid="work-process-tool-card"]')].map((card) => card.closest('li')?.getAttribute('data-testid')));
});

it('keeps an unlinked historical Hook in its event slot with its original message available on expansion', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const row = { type: 'diagnostic' as const, id: 'diagnostic-hook.completed', status: 'complete' as const,
    severity: 'info' as const, isHookDiagnostic: true, message: 'Hook rdc-shell-audit: completed',
    detailLines: [], duration: '' };
  try {
    await act(async () => root.render(createElement(ScopedWorkDisclosure, { scope: 'historical-hook',
      children: createElement(DiagnosticRow, { row, density: 'compact' }) })));
    expect(host.querySelector('.work-process-diagnostic-message')).toBeNull();
    expect(host.textContent).not.toContain(row.message);
    const button = host.querySelector<HTMLButtonElement>('.is-orphan-hook .work-card-trigger')!;
    expect(button.getAttribute('aria-expanded')).toBe('false');
    await act(async () => button.click());
    expect(host.querySelector('.work-process-orphan-hook-message')?.textContent).toBe(row.message);
    expect(button.getAttribute('aria-expanded')).toBe('true');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('opens the same detail and raw receipt components at both densities', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const row: ToolRowModel = { type: 'tool', id: 'same-record', status: 'error', verb: 'Read failed', category: 'task',
    icon: 'fileRead', groupKind: 'task', family: 'file', toolName: 'read_file', target: 'README.md', duration: '20ms',
    argsLines: ['path: README.md'], previewLines: ['ENOENT'], rawLines: ['file missing'], bodyText: 'README.md',
    diagnosticCaption: 'Read failed' };
  const read = async (density: 'normal' | 'compact', scope: string) => {
    await act(async () => root.render(createElement(ScopedWorkDisclosure, { scope,
      children: createElement(ToolRow, { row, density }) })));
    await act(async () => host.querySelector<HTMLButtonElement>('.work-card-trigger')!.click());
    const card = host.querySelector('.work-process-tool-card')!;
    return { detail: card.querySelector('.work-process-tool-card-expand')?.textContent,
      raw: card.querySelector('.work-process-tool-card-raw')?.textContent,
      diagnostic: card.querySelector('.work-process-tool-diagnostic')?.textContent,
      buttonCount: card.querySelectorAll('.work-card-trigger').length };
  };
  try {
    const normal = await read('normal', 'normal-record');
    const compact = await read('compact', 'compact-record');
    expect(normal).toEqual(compact);
    expect(normal.raw).toContain('file missing');
    expect(normal.buttonCount).toBe(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('keeps completed Hooks in tool detail and shows Hook warnings without changing tool status', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const row: ToolRowModel = { type: 'tool', id: 'hook-owner', status: 'complete', verb: 'Ran command',
    category: 'task', icon: 'terminal', groupKind: 'task', family: 'shell', toolName: 'shell.command',
    target: '', duration: '30ms', argsLines: [], previewLines: [], rawLines: [],
    hookDiagnostics: [
      { id: 'hook-ok', code: 'hook.completed', severity: 'info', message: 'Hook audit: completed', timestamp: 1 },
      { id: 'hook-warn', code: 'hook.failed', severity: 'warning', message: 'Hook inspect: failed', timestamp: 2 },
    ] };
  try {
    await act(async () => root.render(createElement(ScopedWorkDisclosure, { scope: 'hook-card',
      children: createElement(ToolRow, { row, density: 'compact' }) })));
    expect(host.querySelector('.work-process-tool-hook-attention')?.textContent).toBe('Hook inspect: failed');
    expect(host.textContent).not.toContain('Hook audit: completed');
    expect(host.querySelector('.work-process-tool-card')?.classList.contains('status-complete')).toBe(true);
    await act(async () => host.querySelector<HTMLButtonElement>('.work-card-trigger')!.click());
    expect(host.querySelector('.work-process-tool-hook-attention')).toBeNull();
    expect(host.querySelector('.work-process-tool-hook-details')?.textContent).toContain('Hook audit: completed');
    expect(host.querySelector('.work-process-tool-hook-details')?.textContent).toContain('Hook inspect: failed');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
