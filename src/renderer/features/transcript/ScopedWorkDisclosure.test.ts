// @vitest-environment happy-dom
import React, { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ScopedWorkDisclosure, useScopedWorkDisclosure } from './ScopedWorkDisclosure';

it('preserves a delegated tool disclosure through windowed unmounts and scopes each call', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const Probe: React.FC<{ defaultOpen?: boolean }> = ({ defaultOpen = false }) => {
    const [open, toggle] = useScopedWorkDisclosure('tool-read', defaultOpen);
    return createElement('button', { type: 'button', 'aria-expanded': open, onClick: toggle }, 'Tool');
  };
  const render = (scope: string, defaultOpen = false) => createElement(ScopedWorkDisclosure,
    { scope, children: createElement(Probe, { defaultOpen }) });
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
