// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ProjectRecord, SessionRecord } from '@shared/types/session';
import { RenamePopover, type RenamePopoverProps } from './RenamePopover';
import { SessionListItem } from './SessionListItem';

vi.mock('../../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
const project = { projectId: 'project', name: 'Project' } as ProjectRecord;
const session = { sessionId: 'session', projectId: 'project', title: '会话 Long name' } as SessionRecord;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('keeps selection separate from rename/remove actions and targets the exact session', () => {
  const activate = vi.fn(); const rename = vi.fn(); const remove = vi.fn();
  act(() => root.render(createElement(SessionListItem, {
    project, session, isSessionRailActive: true, onActivate: activate,
    onContextMenu: vi.fn(), onRenameClick: rename, onRemoveClick: remove,
    onRenameKeyDown: vi.fn(), onRemoveKeyDown: vi.fn(),
  })));
  const buttons = host.querySelectorAll('button');
  act(() => buttons[1].click()); expect(rename.mock.calls[0][1]).toBe(session); expect(activate).not.toHaveBeenCalled();
  act(() => buttons[2].click()); expect(remove.mock.calls[0][1]).toBe(session); expect(activate).not.toHaveBeenCalled();
  act(() => buttons[0].click()); expect(activate).toHaveBeenCalledExactlyOnceWith(project, session);
  expect(host.querySelector('.is-selected')).not.toBeNull();
});

it('focuses/selects a new rename target, preserves editing focus, commits Enter and dismisses outside', () => {
  const close = vi.fn(); const commit = vi.fn();
  const props: RenamePopoverProps = {
    isBusy: false, renamePopover: { session, x: 5, y: 10, titleDraft: session.title },
    projectMenuPopover: null, projectRenamePopover: null,
    onRenameDraftChange: vi.fn(), onProjectRenameDraftChange: vi.fn(),
    onCloseRename: close, onCloseProjectMenu: vi.fn(), onCloseProjectRename: vi.fn(),
    onCommitSessionRename: commit, onCommitProjectRename: vi.fn(), onOpenExplorer: vi.fn(),
    onStartProjectRename: vi.fn(), onSessionCreate: vi.fn(), onRemoveProject: vi.fn(),
  };
  act(() => root.render(createElement(RenamePopover, props)));
  const input = host.querySelector('input')!;
  expect(document.activeElement).toBe(input); expect(input.selectionEnd).toBe(session.title.length);
  input.setSelectionRange(2, 2);
  act(() => root.render(createElement(RenamePopover, { ...props, renamePopover: { ...props.renamePopover!, x: 20 } })));
  expect(document.activeElement).toBe(input); expect(input.selectionStart).toBe(2);
  act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
  expect(commit).toHaveBeenCalledOnce();
  act(() => input.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  expect(close).not.toHaveBeenCalled();
  act(() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  expect(close).toHaveBeenCalledOnce();
  act(() => root.render(createElement(RenamePopover, { ...props, renamePopover: null })));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(close).toHaveBeenCalledOnce();
});
