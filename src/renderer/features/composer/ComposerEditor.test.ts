// @vitest-environment happy-dom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ComposerViewProvider, type ComposerView } from './ComposerControllerContext';
import { ComposerEditor } from './ComposerEditor';

const editor = vi.hoisted(() => ({
  release: null as null | (() => void),
  props: null as null | { value: string; focusOnCreate?: boolean },
}));
vi.mock('./ComposerMarkdownInput', async () => {
  await new Promise<void>((resolve) => {
    editor.release = resolve;
  });
  return {
    ComposerMarkdownInput: (props: { value: string; focusOnCreate?: boolean }) => {
      editor.props = props;
      return createElement('div', { 'data-testid': 'markdown-editor' }, props.value);
    },
  };
});

let root: Root;
let host: HTMLDivElement;

function Probe() {
  const [promptValue, setPromptValue] = useState('');
  const view = {
    composer: {
      promptValue,
      setPromptValue,
      promptInputRef: { current: null },
      isComposerBusy: false,
      promptPlaceholder: 'Ask',
      handlePromptSend: vi.fn(),
      handleFilesIngest: vi.fn(),
      handlePromptKeyDown: vi.fn(),
    },
    scopeKey: 'project:session',
    markdown: true,
    markdownMode: 'write',
    slashCommand: { visible: false },
  } as unknown as ComposerView;
  return createElement(ComposerViewProvider, { value: view }, createElement(ComposerEditor));
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it('keeps text typed before the Markdown editor loads and hands it focus when it takes over', async () => {
  await act(async () => root.render(createElement(Probe)));
  const field = host.querySelector('textarea')!;
  expect(field.classList.contains('composer-textarea')).toBe(true);
  expect(host.querySelector('[data-testid="markdown-editor"]')).toBeNull();

  field.focus();
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setValue.call(field, 'typed early');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });

  await vi.waitFor(() => expect(editor.release).not.toBeNull());
  await act(async () => editor.release!());
  await vi.waitFor(() => expect(host.querySelector('[data-testid="markdown-editor"]')).not.toBeNull());
  expect(host.querySelector('textarea')).toBeNull();
  expect(editor.props).toMatchObject({ value: 'typed early', focusOnCreate: true });
});
