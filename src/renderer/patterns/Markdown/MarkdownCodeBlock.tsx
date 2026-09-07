import React, { useCallback, useState } from 'react';
import { useClipboardBridge } from '../../hooks/useClipboardBridge';
import { useI18n } from '../../i18n';

interface MarkdownCodeBlockProps {
  language: string;
  code: string;
  children: React.ReactNode;
}

export const MarkdownCodeBlock: React.FC<MarkdownCodeBlockProps> = ({
  language,
  code,
  children,
}) => {
  const { t } = useI18n();
  const { copyText } = useClipboardBridge();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const didCopy = await copyText(code);
    setCopied(didCopy);
    if (didCopy) window.setTimeout(() => setCopied(false), 1600);
  }, [code, copyText]);

  const label = language.trim() || t('chat.markdownCodePlain');

  return (
    <div className="markdown-code-block" data-testid="markdown-code-block">
      <div className="markdown-code-block-header">
        <span className="markdown-code-block-lang">{label}</span>
        <button
          type="button"
          className="button button-ghost markdown-code-block-copy"
          onClick={() => void handleCopy()}
          aria-label={t('chat.markdownCopyCode')}
        >
          {copied ? t('chat.markdownCopied') : t('chat.markdownCopyCode')}
        </button>
      </div>
      <pre className="markdown-code-block-pre">{children}</pre>
    </div>
  );
};

export default MarkdownCodeBlock;
