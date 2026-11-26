// @vitest-environment happy-dom
import React, { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ScopedWorkDisclosure, useScopedWorkDisclosure } from './ScopedWorkDisclosure';

it("changes open state once per scope or default change and never paints the previous row's state first", async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const painted: boolean[] = [];
  const Probe: React.FC<{ defaultOpen: boolean }> = ({ defaultOpen }) => {
    const [open, toggle] = useScopedWorkDisclosure('root', defaultOpen);
    painted.push(open);
    return createElement('button', { type: 'button', 'aria-expanded': open, onClick: toggle }, 'Working');
  };
  const render = (scope: string, defaultOpen: boolean) =>
    act(async () =>
      root.render(createElement(ScopedWorkDisclosure, { scope, children: createElement(Probe, { defaultOpen }) })),
    );
  const root = createRoot(host);
  try {
    await render('request:folded:assistant', false);
    await render('request:running:assistant', true);
    expect(painted).toEqual([false, true]);
    // The turn completes: the fold shows in the same render as the completed trace.
    painted.length = 0;
    await render('request:running:assistant', false);
    expect(painted).toEqual([false]);
    // A choice made while the row was still a placeholder holds after main's message takes its place.
    await act(async () => host.querySelector('button')!.click());
    await render('request:running:assistant', false);
    expect(host.querySelector('button')?.getAttribute('aria-expanded')).toBe('true');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('preserves a delegated tool disclosure through windowed unmounts and scopes each call', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const Probe: React.FC<{ defaultOpen?: boolean }> = ({ defaultOpen = false }) => {
    const [open, toggle] = useScopedWorkDisclosure('tool-read', defaultOpen);
    return createElement('button', { type: 'button', 'aria-expanded': open, onClick: toggle }, 'Tool');
  };
  const render = (scope: string, defaultOpen = false) =>
    createElement(ScopedWorkDisclosure, { scope, children: createElement(Probe, { defaultOpen }) });
  let root = createRoot(host);
  try {
    await act(async () => root.render(render('session-a\u0000call-a')));
    await act(async () => host.querySelector('button')!.click());
    expect(host.querySelector('button')?.getAttribute('aria-expanded')).toBe('true');
    await act(async () => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(render('session-a\u0000call-a')));
    expect(host.querySelector('button')?.getAttribute('aria-expanded')).toBe('true');
    await act(async () => root.render(render('session-a\u0000call-b')));
    expect(host.querySelector('button')?.getAttribute('aria-expanded')).toBe('false');
    await act(async () => root.render(render('session-a\u0000call-b', true)));
    expect(host.querySelector('button')?.getAttribute('aria-expanded')).toBe('true');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
