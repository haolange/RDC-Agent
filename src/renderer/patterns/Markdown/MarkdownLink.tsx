import React from 'react';
import { normalizeWebUrl, webHostname } from '@shared/utils/webUrl';
import { OverflowFade } from '../../ui/OverflowFade';
import { FaviconImage } from '../FaviconImage';
import { useMarkdownSourceScope, type MarkdownSource } from './markdownSources';

type AnchorProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown };

const sourceTooltip = (source: MarkdownSource) =>
  [source.title, source.summary].filter(Boolean).join('\n') || source.url;

/** A page this turn read, cited inline: favicon and site, the title and summary on hover. */
export const CitationPill: React.FC<{ source: MarkdownSource }> = ({ source }) => (
  <a
    className="markdown-citation"
    href={source.url}
    target="_blank"
    rel="noreferrer noopener"
    data-tooltip={sourceTooltip(source)}
  >
    <FaviconImage domain={source.domain} />
    <OverflowFade className="markdown-citation-label" text={source.domain} />
  </a>
);

/**
 * Links in rendered Markdown. In-page anchors (footnotes) keep their ids and aria wiring and never open a window; a link
 * to a page this turn read becomes a citation pill; any other link opens outside the app (https only, enforced by the
 * main process) and names its site on hover.
 */
export const MarkdownLink: React.FC<AnchorProps> = ({ href, children, node: _node, ...rest }) => {
  const { sources } = useMarkdownSourceScope();
  if (!href) return <span>{children}</span>;
  if (href.startsWith('#'))
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  const source = sources.get(normalizeWebUrl(href));
  if (source) return <CitationPill source={source} />;
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" data-tooltip={webHostname(href)} {...rest}>
      {children}
    </a>
  );
};
