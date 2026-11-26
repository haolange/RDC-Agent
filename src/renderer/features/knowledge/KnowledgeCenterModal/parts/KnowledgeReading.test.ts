// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { ClipboardContext } from '../../../../lib/clipboard';
import { DetailColumn } from '../columns/DetailColumn';
import { ConflictRow } from './ConflictRow';
import { KnowledgeCardImage } from './KnowledgeCardImage';

vi.mock('../../../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

it('presents the same conflict as a selection in the list and as named facts in the confirmation', () => {
  const cards = { left: { title: 'Light accumulation' }, right: { title: 'Surface response' } };
  const list = renderToStaticMarkup(createElement(ConflictRow, { ...cards, onSelect: vi.fn() }));
  const facts = renderToStaticMarkup(createElement(ConflictRow, cards));
  expect(list).toContain('<button');
  expect(list).not.toContain('knowledgeCenter.conflictPending');
  expect(facts).not.toContain('<button');
  expect(facts).toContain(cards.left.title);
  expect(facts).toContain(cards.right.title);
});

it('copies diagnostics for the selected draft from its actions without expanding metadata', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const mounted = createRoot(host);
  const copy = vi.fn(async () => true);
  const props = {
    state: {
      viewMode: 'cards',
      selectedCard: {
        spaceId: 'user',
        cardId: 'record-a',
        title: 'First record',
        type: 'fact',
        lifecycle: 'draft',
        body: '',
        scope: {},
        relations: [],
        sourceHash: 'selected-revision',
      },
      spaces: [{ kind: 'user', spaceId: 'user' }],
    },
    write: {},
    onCreateCandidate: vi.fn(),
    candidateHasSession: true,
    candidateBusy: false,
    candidateError: null,
  } as unknown as Parameters<typeof DetailColumn>[0];
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  try {
    await act(async () =>
      mounted.render(createElement(ClipboardContext.Provider, { value: copy }, createElement(DetailColumn, props))),
    );
    expect(host.querySelector('[data-testid="knowledge-center-meta"]')).toBeNull();
    expect(host.textContent).not.toContain('selected-revision');
    const trigger = host.querySelector<HTMLButtonElement>('[data-testid="knowledge-center-more-actions"]')!;
    await act(async () => trigger.click());
    const item = document.querySelector<HTMLButtonElement>(
      '[role="menuitem"][data-testid="knowledge-center-provenance"]',
    )!;
    await act(async () => item.click());
    expect(copy).toHaveBeenCalledWith('cardId: record-a\nknowledgeCenter.metaSourceHash: selected-revision');
    expect(trigger.dataset.tooltip).toBe('app.copied');
  } finally {
    await act(async () => mounted.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('reports a missing comparison image only after the image request settles', async () => {
  let settle!: (result: { dataUrl?: string }) => void;
  const pending = new Promise<{ dataUrl?: string }>((resolve) => {
    settle = resolve;
  });
  const host = document.createElement('div');
  const mounted = createRoot(host);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('electronAPI', { knowledge: { image: () => pending } });
  try {
    await act(async () =>
      mounted.render(createElement(KnowledgeCardImage, { spaceId: 'user', relativePath: 'evidence.png' })),
    );
    expect(host.querySelector('[role="status"]')).toBeTruthy();
    expect(host.textContent).not.toContain('knowledgeCenter.imageMissing');
    await act(async () => {
      settle({});
    });
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(host.textContent).toContain('knowledgeCenter.imageMissing');
  } finally {
    await act(async () => mounted.unmount());
    vi.unstubAllGlobals();
  }
});
