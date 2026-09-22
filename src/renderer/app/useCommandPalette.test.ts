// @vitest-environment happy-dom
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { useCommandPalette } from './useCommandPalette';
import { useCommandPaletteStore } from '../stores/commandPaletteStore';

describe('command palette controller lifecycle', () => {
  it('installs one keyboard listener in StrictMode and removes it on unmount', () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    useCommandPaletteStore.setState({ open: false, query: '' });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    function Controller() { useCommandPalette(); return null; }
    try {
      act(() => root.render(createElement(StrictMode, null, createElement(Controller))));
      act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })));
      expect(useCommandPaletteStore.getState().open).toBe(true);
      act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
      expect(useCommandPaletteStore.getState().open).toBe(false);
      act(() => root.unmount());
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
      expect(useCommandPaletteStore.getState().open).toBe(false);
    } finally { host.remove(); }
  });
});
