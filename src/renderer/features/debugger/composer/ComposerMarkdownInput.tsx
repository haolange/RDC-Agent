import React, { useEffect, useMemo, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
import { Prec, type Extension } from '@codemirror/state';
import { indentWithTab } from '@codemirror/commands';
import { useI18n } from '../../../i18n';
import { MessageMarkdown } from '../AgentChat/MessageMarkdown';
import './ComposerMarkdownInput.css';

export type ComposerMarkdownMode = 'write' | 'preview';

interface ComposerMarkdownInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  placeholder: string;
  disabled?: boolean;
}

const composerEditorTheme = EditorView.theme({
  '&': {
    backgroundColor: 'transparent',
    color: 'var(--token-text-body)',
    fontSize: 'var(--text-base)',
  },
  '.cm-content': {
    fontFamily: 'var(--font-sans)',
    caretColor: 'var(--token-accent-primary)',
    padding: '0',
    minHeight: '24px',
  },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: '1.55',
    overflow: 'auto',
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
  placeholder,
  disabled = false,
}) => {
  const { t } = useI18n();
  const [mode, setMode] = useState<ComposerMarkdownMode>('write');

  useEffect(() => {
    if (disabled && mode === 'preview') {
      setMode('write');
    }
  }, [disabled, mode]);

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
      EditorView.editable.of(!disabled),
    ], [disabled, onSend, placeholder]);

  return (
    <div className="composer-markdown-input" data-testid="composer-markdown-input" data-mode={mode}>
      <div className="composer-markdown-toolbar" role="tablist" aria-label={t('settings.composerMarkdown')}>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'write'}
          className={`button button-ghost composer-markdown-tab ${mode === 'write' ? 'is-active' : ''}`}
          onClick={() => setMode('write')}
          disabled={disabled}
        >
          {t('composer.markdownWrite')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'preview'}
          className={`button button-ghost composer-markdown-tab ${mode === 'preview' ? 'is-active' : ''}`}
          onClick={() => setMode('preview')}
          disabled={disabled}
        >
          {t('composer.markdownPreview')}
        </button>
      </div>

      {mode === 'preview' ? (
        <div
          className="composer-markdown-preview scrollbar-thin"
          data-testid="composer-markdown-preview"
          aria-label={t('composer.markdownPreview')}
        >
          {value.trim() ? (
            <MessageMarkdown content={value} />
          ) : (
            <p className="composer-markdown-preview-empty">{placeholder}</p>
          )}
        </div>
      ) : (
        <CodeMirror
          className="composer-markdown-editor"
          value={value}
          height="auto"
          maxHeight="180px"
          basicSetup={{
            lineNumbers: false,
            foldGutter: false,
            highlightActiveLine: false,
            highlightActiveLineGutter: false,
            bracketMatching: true,
          }}
          extensions={extensions}
          onChange={onChange}
          editable={!disabled}
          aria-label={placeholder}
        />
      )}
    </div>
  );
};

export default ComposerMarkdownInput;
