// @vitest-environment happy-dom
import { act, createElement, createRef, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ComposerEditor } from './ComposerEditor';
import { ComposerFooter } from './ComposerFooter';

// Domain menus have separate interaction suites; keep actual editor and action controls mounted.
vi.mock('./ComposerAgentMenu', () => ({ ComposerAgentMenu: () => null }));
vi.mock('./PermissionModeSelector', () => ({ PermissionModeSelector: () => null }));
vi.mock('./ComposerModelEffortControl', () => ({ ComposerModelEffortControl: () => null }));
vi.mock('./useComposerMenuRegistry', () => ({ useComposerMenu: () => ({}) }));
vi.mock('../../patterns/ContextUsageIndicator', () => ({ ContextUsageIndicator: () => null }));
vi.mock('./SlashCommandPopover', () => ({ SlashCommandPopover: () => null }));
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); host.remove(); });

it('routes attachment/send/stop actions and preserves disabled behavior as running state changes', async () => {
  const send = vi.fn(); const stop = vi.fn(); const attach = vi.fn();
  const props = {
    isComposerBusy: false, primaryButtonDisabled: true, primaryButtonDescription: 'Send',
    attachButtonLabel: 'Attach', handlePromptSend: send, handlePrimaryStop: stop, handleAttachmentSelect: attach,
  } as unknown as ComponentProps<typeof ComposerFooter>;
  const render = (extra: Partial<ComponentProps<typeof ComposerFooter>>) => act(async () => {
    root.render(createElement(ComposerFooter, { ...props, ...extra }));
  });
  await render({});
  await act(async () => host.querySelector<HTMLButtonElement>('.chat-send-button')!.click());
  expect(send).not.toHaveBeenCalled();
  await render({ primaryButtonDisabled: false });
  await act(async () => {
    host.querySelector<HTMLButtonElement>('.chat-send-button')!.click();
    host.querySelector<HTMLButtonElement>('.composer-attach-button')!.click();
  });
  expect(send).toHaveBeenCalledTimes(1); expect(attach).toHaveBeenCalledTimes(1);
  await render({ isComposerBusy: true, primaryButtonDisabled: false, primaryButtonDescription: 'Stop' });
  expect(host.querySelector('[data-testid="debugger-stop-button"]')?.getAttribute('aria-label')).toBe('Stop');
  await act(async () => {
    host.querySelector<HTMLButtonElement>('.chat-send-button')!.click();
    host.querySelector<HTMLButtonElement>('.composer-attach-button')!.click();
  });
  expect(stop).toHaveBeenCalledTimes(1); expect(send).toHaveBeenCalledTimes(1); expect(attach).toHaveBeenCalledTimes(1);
});

it('renders long controlled drafts, forwards text/IME events and remounts the input on session replacement', async () => {
  const ref = createRef<HTMLTextAreaElement>();
  const change = vi.fn(); const keydown = vi.fn();
  const props: ComponentProps<typeof ComposerEditor> = {
    composerMarkdown: false, composerScopeKey: 'session-a', markdownMode: 'write',
    promptValue: '中文 long draft\n'.repeat(200), setPromptValue: change, promptInputRef: ref,
    isComposerBusy: false, promptPlaceholder: 'Message', handlePromptSend: vi.fn(), handleFilesIngest: vi.fn(),
    handlePromptKeyDown: keydown, slashCommand: { visible: false } as ComponentProps<typeof ComposerEditor>['slashCommand'],
  };
  await act(async () => root.render(createElement(ComposerEditor, props)));
  const original = ref.current!;
  expect(original.value).toBe(props.promptValue);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(original, '输入');
    original.dispatchEvent(new Event('input', { bubbles: true }));
    original.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
  });
  expect(change).toHaveBeenCalledWith('输入');
  expect(keydown.mock.calls[0][0].nativeEvent.isComposing).toBe(true);
  await act(async () => root.render(createElement(ComposerEditor, { ...props, composerScopeKey: 'session-b', promptValue: '' })));
  expect(ref.current).not.toBe(original); expect(ref.current!.value).toBe(''); expect(original.isConnected).toBe(false);
});
