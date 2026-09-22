import React, { useEffect, useMemo, useRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
import { Prec, type Extension } from '@codemirror/state';
import { indentWithTab } from '@codemirror/commands';
import { registerCodeMirrorView } from '../../lib/contextMenuCommands';
import { useComposerMarkdownSizing } from './useComposerMarkdownSizing';
import { MessageMarkdown } from '../../patterns/Markdown/MessageMarkdown';
import './ComposerMarkdownInput.css';

export type ComposerMarkdownMode = 'write' | 'preview';


interface ComposerMarkdownInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onPasteFiles?: (files: File[]) => void;
  placeholder: string;
  mode: ComposerMarkdownMode;
  disabled?: boolean;
}

const composerEditorTheme = EditorView.theme({
  '&': {
    width: '100%',
    height: '100%',
    backgroundColor: 'transparent',
    color: 'var(--token-text-body)',
    /* Inherit host (= .composer-textarea → --text-base); never --text-md. */
    fontSize: 'inherit',
    lineHeight: 'inherit',
  },
  '.cm-content': {
    fontFamily: 'var(--font-sans)',
    caretColor: 'var(--token-accent-primary)',
    padding: '0',
    width: '100%',
    fontSize: 'inherit',
    lineHeight: 'inherit',
    boxSizing: 'border-box',
  },
  '.cm-line': {
    padding: '0',
  },
  '.cm-scroller': {
    fontFamily: 'inherit',
    fontSize: 'inherit',
    lineHeight: 'inherit',
    overflow: 'auto',
    width: '100%',
    height: '100%',
  },
  '.cm-gutters': {
    display: 'none',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-activeLine': {
    backgroundColor: 'transparent',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--token-accent-primary) 28%, transparent)',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--token-accent-primary)',
  },
  '.cm-placeholder': {
    color: 'var(--token-text-caption)',
    fontStyle: 'normal',
    fontSize: 'inherit',
    lineHeight: 'inherit',
  },
  '.tok-header': { color: 'var(--token-text-heading)', fontWeight: 'var(--font-semibold)' },
  '.tok-strong': { color: 'var(--token-text-heading)', fontWeight: 'var(--font-semibold)' },
  '.tok-emphasis': { fontStyle: 'italic' },
  '.tok-link': { color: 'var(--token-text-link)' },
  '.tok-url': { color: 'var(--token-text-link)' },
  '.tok-monospace, .tok-code': {
    color: 'var(--token-text-heading)',
    fontFamily: 'var(--font-mono)',
  },
  '.tok-meta': { color: 'var(--token-text-caption)' },
  '.tok-heading1, .tok-heading2, .tok-heading3, .tok-heading4': {
    color: 'var(--token-text-heading)',
    fontWeight: 'var(--font-semibold)',
  },
});

export const ComposerMarkdownInput: React.FC<ComposerMarkdownInputProps> = ({
  value,
  onChange,
  onSend,
  onPasteFiles,
  placeholder,
  mode,
  disabled = false,
}) => {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => {
    if (hostRef.current) registerCodeMirrorView(hostRef.current, null);
  }, []);

  const syncHostHeight = useComposerMarkdownSizing(hostRef, value, mode);

  const extensions = useMemo((): Extension[] => [
      markdown(),
      composerEditorTheme,
      cmPlaceholder(placeholder),
      EditorView.lineWrapping,
      keymap.of([indentWithTab]),
      Prec.highest(
        keymap.of([
          {
            key: 'Enter',
            run: () => {
              onSend();
              return true;
            },
          },
        ]),
      ),
      EditorView.domEventHandlers({
        paste: (event) => {
          if (!onPasteFiles) return false;
          const files = Array.from(event.clipboardData?.files ?? []);
          if (files.length === 0) return false;
          event.stopPropagation();
          const text = event.clipboardData?.getData('text/plain') ?? '';
          if (text.trim()) {
            onPasteFiles(files);
            return false;
          }
          event.preventDefault();
          onPasteFiles(files);
          return true;
        },
      }),
      EditorView.editable.of(!disabled),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged && !update.viewportChanged) {
          return;
        }
        if (mode !== 'write') {
          return;
        }
        syncHostHeight();
      }),
    ], [disabled, mode, onPasteFiles, onSend, placeholder, syncHostHeight]);

  return (
    <div
      ref={hostRef}
      className="composer-markdown-input"
      data-testid="composer-markdown-input"
      data-mode={mode}
    >
      <div className="composer-markdown-stage">
        <div
          className={`composer-markdown-pane composer-markdown-editor-pane ${mode === 'write' ? 'is-active' : 'is-inactive'}`}
          aria-hidden={mode !== 'write'}
        >
          <CodeMirror
            className="composer-markdown-editor"
            value={value}
            height="100%"
            basicSetup={{
              lineNumbers: false,
              foldGutter: false,
              highlightActiveLine: false,
              highlightActiveLineGutter: false,
              bracketMatching: true,
            }}
            extensions={extensions}
            onChange={onChange}
            onCreateEditor={(view) => {
              if (hostRef.current) registerCodeMirrorView(hostRef.current, view);
            }}
            editable={!disabled && mode === 'write'}
            aria-label={placeholder}
          />
        </div>
        <div
          className={`composer-markdown-pane composer-markdown-preview scrollbar-thin ${mode === 'preview' ? 'is-active' : 'is-inactive'}`}
          data-testid="composer-markdown-preview"
          aria-label={placeholder}
          aria-hidden={mode !== 'preview'}
        >
          {value.trim() ? (
            <MessageMarkdown content={value} />
          ) : (
            <p className="composer-markdown-preview-empty">{placeholder}</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default ComposerMarkdownInput;
