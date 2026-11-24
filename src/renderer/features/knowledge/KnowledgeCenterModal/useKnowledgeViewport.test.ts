// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useKnowledgeViewport } from './useKnowledgeViewport';

it('moves keyboard focus between a replaced narrow pane and the selected row', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => Object.assign(new EventTarget(), {
    matches: true, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(),
  }));
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);

  function Harness() {
    const viewport = useKnowledgeViewport();
    const listTab = createElement('button', { onClick: () => viewport.setNarrowPane('list') }, 'List');
    const list = createElement('div', { ref: viewport.listFocusRef, tabIndex: -1 }, createElement('button', {
      'aria-selected': true, onClick: () => viewport.navigateToPane('detail'),
    }, 'Selected card'));
    const detail = createElement('button', {
      ref: viewport.backButtonRef, onClick: () => viewport.navigateToPane('list'),
    }, 'Back');
    const pane = viewport.narrowPane === 'list' ? list : viewport.narrowPane === 'detail' ? detail : null;
    return createElement('div', null, listTab, pane);
  }

  try {
    await act(async () => root.render(createElement(Harness)));
    const listTab = host.querySelector<HTMLButtonElement>('button')!;
    listTab.focus();
    await act(async () => listTab.click());
    expect(document.activeElement).toBe(listTab);
    const row = host.querySelector<HTMLButtonElement>('[aria-selected="true"]')!;
    row.focus();
    await act(async () => row.click());
    expect(document.activeElement?.textContent).toBe('Back');
    await act(async () => (document.activeElement as HTMLButtonElement).click());
    expect(document.activeElement).toBe(host.querySelector('[aria-selected="true"]'));
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
