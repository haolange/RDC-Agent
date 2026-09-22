// @vitest-environment happy-dom
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MaterialContextEditor } from './MaterialContextEditor';
import { MaterialContextViewer } from './MaterialContextViewer';
import { TaskDialog } from '../ui/TaskDialog';
import { isTopOverlayLayer } from '../lib/overlayStack';

vi.mock('../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

let root: Root;
let trigger: HTMLButtonElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  trigger = document.createElement('button');
  document.body.append(trigger);
  trigger.focus();
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  expect(isTopOverlayLayer(null)).toBe(true);
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
const button = (text: string) => [...document.querySelectorAll('button')].find(node => node.textContent === text)!;

describe('Material task dialogs', () => {
  it('preserves keyboard image region editing and saves normalized context before closing', () => {
    const events: string[] = [];
    const onSave = vi.fn(() => events.push('save'));
    act(() => root.render(createElement(StrictMode, null, createElement(MaterialContextEditor, {
      fileName: 'image.png', previewUrl: 'blob:preview', value: { intent: ' inspect ' },
      onSave, onClose: () => events.push('close'),
    }))));
    const image = document.querySelector('svg.material-context-image')!;
    act(() => image.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    act(() => image.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true })));
    act(() => button('material.save').click());
    expect(onSave).toHaveBeenCalledWith({ intent: 'inspect', region: { x: 0.26, y: 0.25, width: 0.5, height: 0.51 } });
    expect(events).toEqual(['save', 'close']);
  });

  it('retains invalid drafts, keeps backdrop presses non-destructive and restores trigger focus', () => {
    const onSave = vi.fn(); const onClose = vi.fn();
    act(() => root.render(createElement(MaterialContextEditor, {
      fileName: 'capture', previewUrl: null, value: { timeRange: { startSeconds: 5, endSeconds: 2 } }, onSave, onClose,
    })));
    act(() => button('material.save').click());
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('material.validationError');
    expect(onSave).not.toHaveBeenCalled();
    act(() => document.querySelector('.task-dialog-overlay')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(onClose).not.toHaveBeenCalled();
    act(() => button('material.cancel').click());
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => root.render(null));
    expect(document.activeElement).toBe(trigger);
  });

  it('opens originals by identity and closes only the top layer with Escape', () => {
    const outerClose = vi.fn(); const viewerClose = vi.fn(); const onOpenOriginal = vi.fn();
    act(() => root.render(createElement(TaskDialog, {
      open: true, title: 'outer', onClose: outerClose, closeLabel: 'close', children: null,
    })));
    act(() => root.render(createElement(TaskDialog, {
      open: true, title: 'outer', onClose: outerClose, closeLabel: 'close',
      children: createElement(MaterialContextViewer, {
        items: [{ id: 'a', name: 'A', previewUrl: 'blob:a', material: { intent: 'compare', region: { x: 0, y: 0, width: 1, height: 1 } }, hash: 'abc' }],
        onClose: viewerClose, onOpenOriginal,
      }),
    })));
    act(() => button('material.openOriginal').click());
    expect(onOpenOriginal).toHaveBeenCalledWith('a');
    expect(document.querySelector('.material-context-preview rect')?.getAttribute('width')).toBe('1');
    expect(document.querySelector('.material-context-gallery code')?.textContent).toBe('abc');
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(viewerClose).toHaveBeenCalledTimes(1);
    expect(outerClose).not.toHaveBeenCalled();
  });
});
