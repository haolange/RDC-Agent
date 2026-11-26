// @vitest-environment happy-dom
import { act, createElement, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ComposerEditor } from './ComposerEditor';
import { ComposerFooter } from './ComposerFooter';
import { ComposerViewProvider, type ComposerView } from './ComposerControllerContext';

// Domain menus have separate interaction suites; keep actual editor and action controls mounted.
vi.mock('./ComposerAgentMenu', () => ({ ComposerAgentMenu: () => null }));
vi.mock('./PermissionModeSelector', () => ({ PermissionModeSelector: () => null, PermissionSwitchNotice: () => null }));
vi.mock('./ComposerModelEffortControl', () => ({ ComposerModelEffortControl: () => null }));
vi.mock('./useComposerMenuRegistry', () => ({ useComposerMenu: () => ({}) }));
vi.mock('../../patterns/ContextUsageIndicator', () => ({ ContextUsageIndicator: () => null }));
vi.mock('./SlashCommandPopover', () => ({ SlashCommandPopover: () => null }));
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  host.remove();
});

type ViewFields = Omit<ComposerView, 'composer'> & { composer: Record<string, unknown> };
const view = (fields: Partial<ViewFields>): ComposerView =>
  ({
    currentSession: null,
    activeAgentId: null,
    scopeKey: 'session-a',
    markdown: false,
    markdownMode: 'write',
    slashCommand: { visible: false },
    transitionLabel: '',
    visionSupported: true,
    composer: {},
    ...fields,
  }) as unknown as ComposerView;
const mount = (part: typeof ComposerFooter | typeof ComposerEditor, fields: Partial<ViewFields>) =>
  act(async () => {
    root.render(createElement(ComposerViewProvider, { value: view(fields) }, createElement(part)));
  });

it('routes attachment/send/stop actions and preserves disabled behavior as running state changes', async () => {
  const send = vi.fn();
  const stop = vi.fn();
  const attach = vi.fn();
  const composer = {
    isComposerBusy: false,
    primaryButtonDisabled: true,
    primaryButtonDescription: 'Send',
    attachButtonLabel: 'Attach',
    handlePromptSend: send,
    handlePrimaryStop: stop,
    handleAttachmentSelect: attach,
  };
  const render = (extra: Record<string, unknown>) => mount(ComposerFooter, { composer: { ...composer, ...extra } });
  await render({});
  await act(async () => host.querySelector<HTMLButtonElement>('.chat-send-button')!.click());
  expect(send).not.toHaveBeenCalled();
  await render({ primaryButtonDisabled: false });
  await act(async () => {
    host.querySelector<HTMLButtonElement>('.chat-send-button')!.click();
    host.querySelector<HTMLButtonElement>('.composer-attach-button')!.click();
  });
  expect(send).toHaveBeenCalledTimes(1);
  expect(attach).toHaveBeenCalledTimes(1);
  await render({ isComposerBusy: true, primaryButtonDisabled: false, primaryButtonDescription: 'Stop' });
  expect(host.querySelector('[data-testid="debugger-stop-button"]')?.getAttribute('aria-label')).toBe('Stop');
  await act(async () => {
    host.querySelector<HTMLButtonElement>('.chat-send-button')!.click();
    host.querySelector<HTMLButtonElement>('.composer-attach-button')!.click();
  });
  expect(stop).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledTimes(1);
  expect(attach).toHaveBeenCalledTimes(1);
  // Stop sent, reply already ended locally: the button stays Stop and shows the pending icon until main answers.
  await render({
    isComposerBusy: false,
    stopPending: true,
    primaryButtonDisabled: true,
    primaryButtonDescription: 'Stopping',
  });
  const pending = host.querySelector<HTMLButtonElement>('[data-testid="debugger-stop-button"]');
  expect(pending?.disabled).toBe(true);
  expect(pending?.getAttribute('aria-busy')).toBe('true');
  expect(pending?.querySelector('.ui-spinner')).not.toBeNull();
  expect(host.querySelector('[data-testid="debugger-start-button"]')).toBeNull();
});

it('renders long controlled drafts, forwards text/IME events and remounts the input on session replacement', async () => {
  const ref = createRef<HTMLTextAreaElement>();
  const change = vi.fn();
  const keydown = vi.fn();
  const composer = {
    promptValue: '中文 long draft\n'.repeat(200),
    setPromptValue: change,
    promptInputRef: ref,
    isComposerBusy: false,
    promptPlaceholder: 'Message',
    handlePromptSend: vi.fn(),
    handleFilesIngest: vi.fn(),
    handlePromptKeyDown: keydown,
  };
  await mount(ComposerEditor, { composer });
  const original = ref.current!;
  expect(original.value).toBe(composer.promptValue);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(original, '输入');
    original.dispatchEvent(new Event('input', { bubbles: true }));
    original.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
  });
  expect(change).toHaveBeenCalledWith('输入');
  expect(keydown.mock.calls[0][0].nativeEvent.isComposing).toBe(true);
  await mount(ComposerEditor, { scopeKey: 'session-b', composer: { ...composer, promptValue: '' } });
  expect(ref.current).not.toBe(original);
  expect(ref.current!.value).toBe('');
  expect(original.isConnected).toBe(false);
});
