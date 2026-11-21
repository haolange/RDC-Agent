import React, { useMemo } from 'react';
import { useI18n } from '../../i18n';
import { CitationPill } from './MarkdownLink';
import { citedSources, useMarkdownSourceScope } from './markdownSources';

/** One line under an answer naming the pages it cited, in citation order; nothing when it cited none. */
export const MarkdownSourcesRow: React.FC<{ content: string }> = ({ content }) => {
  const { t } = useI18n();
  const { sources } = useMarkdownSourceScope();
  const cited = useMemo(() => citedSources(content, sources), [content, sources]);
  if (cited.length === 0) return null;
  return (
    <div className="markdown-sources" data-testid="markdown-sources">
      <span className="markdown-sources-label">{t('chat.markdownSources')}</span>
      <span className="markdown-sources-list">
        {cited.map((source) => <CitationPill key={source.url} source={source} />)}
      </span>
    </div>
  );
};
