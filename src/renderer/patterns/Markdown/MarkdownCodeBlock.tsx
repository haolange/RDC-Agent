import React from 'react';
import { useClipboardBridge } from '../../hooks/useClipboardBridge';
import { useI18n } from '../../i18n';
import { CopyButton } from '../../ui/CopyButton';

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

  const label = language.trim() || t('chat.markdownCodePlain');

  return (
    <div className="markdown-code-block" data-testid="markdown-code-block">
      <div className="markdown-code-block-header">
        <span className="markdown-code-block-lang">{label}</span>
        <CopyButton className="markdown-code-block-copy" onCopy={() => copyText(code)}
          label={t('chat.markdownCopyCode')} copiedLabel={t('chat.markdownCopied')} />
      </div>
      <pre className="markdown-code-block-pre">{children}</pre>
    </div>
  );
};

export default MarkdownCodeBlock;
