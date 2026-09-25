// @vitest-environment happy-dom
import React, { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useSubagentDisclosure } from './useSubagentDisclosure';

it('keeps card and section disclosure after message virtualization remounts the row', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const Probe: React.FC<{ session: string }> = ({ session }) => {
    const state = useSubagentDisclosure(session, 'call-disclosure-remount');
    return createElement(React.Fragment, null,
      createElement('button', { 'data-fold': 'card', 'aria-expanded': state.expanded,
        onClick: () => state.openCard(true) }),
      createElement('button', { 'data-fold': 'facts', 'aria-expanded': state.factsOpen, onClick: () => state.toggle('factsOpen') }),
      createElement('button', { 'data-fold': 'work', 'aria-expanded': state.workOpen,
        onClick: () => state.toggle('workOpen') }));
  };
  let root = createRoot(host);
  try {
    await act(async () => root.render(createElement(Probe, { session: 's1' })));
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-fold="card"]')!.click();
      host.querySelector<HTMLButtonElement>('[data-fold="facts"]')!.click();
    });
    expect(host.querySelector('[data-fold="work"]')?.getAttribute('aria-expanded')).toBe('true');
    await act(async () => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(createElement(Probe, { session: 's1' })));
    expect(host.querySelector('[data-fold="card"]')?.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('[data-fold="facts"]')?.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('[data-fold="work"]')?.getAttribute('aria-expanded')).toBe('true');
    await act(async () => root.render(createElement(Probe, { session: 's2' })));
    expect(host.querySelector('[data-fold="card"]')?.getAttribute('aria-expanded')).toBe('false');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('opens live process only on first card expansion and keeps later manual choice', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'); document.body.append(host);
  const Probe = () => {
    const state = useSubagentDisclosure('live', 'call-auto-open');
    return createElement(React.Fragment, null,
      createElement('button', { 'data-fold': 'card', 'aria-expanded': state.expanded, onClick: () => state.openCard(true) }),
      createElement('button', { 'data-fold': 'work', 'aria-expanded': state.workOpen, onClick: () => state.toggle('workOpen') }));
  };
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(Probe)));
    await act(async () => host.querySelector<HTMLButtonElement>('[data-fold="card"]')!.click());
    expect(host.querySelector('[data-fold="work"]')?.getAttribute('aria-expanded')).toBe('true');
    await act(async () => host.querySelector<HTMLButtonElement>('[data-fold="work"]')!.click());
    await act(async () => host.querySelector<HTMLButtonElement>('[data-fold="card"]')!.click());
    await act(async () => host.querySelector<HTMLButtonElement>('[data-fold="card"]')!.click());
    expect(host.querySelector('[data-fold="work"]')?.getAttribute('aria-expanded')).toBe('false');
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
