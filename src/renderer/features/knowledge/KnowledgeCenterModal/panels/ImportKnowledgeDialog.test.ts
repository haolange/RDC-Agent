// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ImportKnowledgeDialog } from './ImportKnowledgeDialog';
import type { KnowledgeCardRecord, KnowledgeImportResult } from '@shared/types/knowledge';

vi.mock('../../../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

type Props = Parameters<typeof ImportKnowledgeDialog>[0];

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const importer = (overrides: Partial<Props['importer']>): Props['importer'] => ({
  open: true, openPanel: vi.fn(), close: vi.fn(), step: 'input', mode: 'file', setMode: vi.fn(), source: '', setSource: vi.fn(),
  filePath: null, spaceId: 'user', setSpaceId: vi.fn(), preview: null, previewPasted: vi.fn(), back: vi.fn(), dropFile: vi.fn(),
  result: null, busy: false, error: null, selectFile: vi.fn(), importSource: vi.fn(),
  ...overrides,
} as Props['importer']);

const candidates = (overrides: Partial<Props['candidates']> = {}): Props['candidates'] => ({
  hasSession: true, inbox: null, refreshInbox: vi.fn(), busy: false, error: null, candidateError: null, createCandidate: vi.fn(),
  ...overrides,
} as Props['candidates']);

const render = (props: Props) => act(async () => root.render(createElement(ImportKnowledgeDialog, props)));

it('locks the source choice while a preview is being read, like the other inputs', async () => {
  await render({ importer: importer({ busy: true }), candidates: candidates(), spaces: [] });
  const modeTabs = [...document.querySelectorAll<HTMLButtonElement>('.knowledge-import-mode [role="tab"]')];
  expect(modeTabs).toHaveLength(2);
  expect(modeTabs.every((tab) => tab.disabled)).toBe(true);
});

it('shows a failed candidate proposal on the imported card it belongs to, with the reason behind the copy action', async () => {
  const card = { cardId: 'card-a', title: 'Hair darkening', type: 'case', images: [] } as unknown as KnowledgeCardRecord;
  const other = { cardId: 'card-b', title: 'Shadow acne', type: 'case', images: [] } as unknown as KnowledgeCardRecord;
  const result: KnowledgeImportResult = {
    candidateCreated: false, verified: false,
    items: [card, other].map((record) => ({ status: 'draft' as const, lifecycle: 'draft' as const, record, missingAssets: [] })),
  };
  await render({
    importer: importer({ step: 'result', result }),
    candidates: candidates({ candidateError: { cardId: 'card-a', message: 'KNOWLEDGE_CANDIDATE_REJECTED: queue full' } }),
    spaces: [],
  });
  const rows = [...document.querySelectorAll('.knowledge-import-item')];
  const failure = rows[0].querySelector('[role="alert"]');
  expect(failure?.textContent).toContain('knowledgeCenter.candidateFailed');
  expect(failure?.textContent).not.toContain('queue full');
  expect(failure?.querySelector('button[aria-label="app.copyDetails"]')).not.toBeNull();
  expect(rows[1].querySelector('[role="alert"]')).toBeNull();
});
