import React, { useState } from 'react';
import { useClipboardBridge } from '../../hooks/useClipboardBridge';
import { useI18n } from '../../i18n';
import { CopyButton } from '../../ui/CopyButton';
import { Icon } from '../../ui/Icon';
import { IconButton } from '../../ui/IconButton';
import { OverflowFade } from '../../ui/OverflowFade';
import { PlainButton } from '../../ui/PlainButton';

/** Blocks longer than this open folded, fading at the fold, with one control to show the rest. */
export const CODE_BLOCK_FOLD_LINES = 30;

interface MarkdownCodeBlockProps {
  language: string;
  /** From the fence: ```ts title="src/app.ts"``` or ```ts:src/app.ts```. */
  fileName?: string;
  code: string;
  children: React.ReactNode;
}

export const MarkdownCodeBlock: React.FC<MarkdownCodeBlockProps> = ({ language, fileName, code, children }) => {
  const { t } = useI18n();
  const { copyText } = useClipboardBridge();
  const lineCount = code.split('\n').length;
  const foldable = lineCount > CODE_BLOCK_FOLD_LINES;
  const [folded, setFolded] = useState(foldable);
  const [wrapped, setWrapped] = useState(false);
  const label = language.trim() || t('chat.markdownCodePlain');
  const className = ['markdown-code-block', wrapped ? 'is-wrapped' : '', foldable && folded ? 'is-folded' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={className} data-testid="markdown-code-block">
      <div className="markdown-code-block-header">
        <span className="markdown-code-block-lang">{label}</span>
        {fileName ? <OverflowFade className="markdown-code-block-file" text={fileName} /> : null}
        <span className="markdown-code-block-actions">
          <IconButton
            size="sm"
            label={t('chat.markdownCodeWrap')}
            aria-pressed={wrapped}
            data-tooltip={t('chat.markdownCodeWrap')}
            className="markdown-code-block-wrap"
            onClick={() => setWrapped((value) => !value)}
          >
            <Icon name="wrap" size={14} />
          </IconButton>
          <CopyButton
            className="markdown-code-block-copy"
            onCopy={() => copyText(code)}
            label={t('chat.markdownCopyCode')}
            copiedLabel={t('chat.markdownCopied')}
          />
        </span>
      </div>
      <pre className="markdown-code-block-pre">{children}</pre>
      {foldable ? (
        <PlainButton
          className="markdown-code-block-fold"
          aria-expanded={!folded}
          onClick={() => setFolded((value) => !value)}
        >
          {folded ? t('chat.markdownCodeExpand', { count: lineCount }) : t('chat.markdownCodeCollapse')}
        </PlainButton>
      ) : null}
    </div>
  );
};

export default MarkdownCodeBlock;
