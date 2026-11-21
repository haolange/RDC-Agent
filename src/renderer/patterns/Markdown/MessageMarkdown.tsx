import React, { useMemo } from 'react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import { isSessionArtifactUri } from '@shared/types/sessionArtifact';
import { useI18n } from '../../i18n';
import { Icon, type IconName } from '../../ui/Icon';
import { normalizeAssistantMarkdown } from './normalizeAssistantMarkdown';
import { MarkdownCodeBlock } from './MarkdownCodeBlock';
import { MarkdownMermaid } from './MarkdownMermaid';
import { MarkdownLink } from './MarkdownLink';
import { MarkdownGallery, MarkdownMedia } from './MarkdownMedia';
import { flattenMarkdownText } from './markdownText';
import { MARKDOWN_LANGUAGES, MARKDOWN_LANGUAGE_ALIASES } from './markdownHighlight';
import { rehypeOpenFence } from './rehypeOpenFence';
import { remarkCallouts, type CalloutKind } from './remarkCallouts';
import { parseCodeFence, remarkCodeFenceTitle } from './codeFence';
import type { Components, Options } from 'react-markdown';
import 'katex/dist/katex.min.css';
import './markdown-rich.css';

interface MessageMarkdownProps {
  content: string;
  /** Skip KaTeX / math while the source is still streaming; only closed code blocks are highlighted. */
  deferHeavyPlugins?: boolean;
  renderImage?: (props: { src?: string; alt?: string }) => React.ReactNode;
  /** Clipped excerpts must not contain unreachable links or code actions. */
  interactive?: boolean;
}

const highlightOptions = { languages: MARKDOWN_LANGUAGES, aliases: MARKDOWN_LANGUAGE_ALIASES };

const STREAMING_REMARK_PLUGINS: NonNullable<Options['remarkPlugins']> = [remarkGfm, remarkCallouts, remarkCodeFenceTitle];
const FULL_REMARK_PLUGINS: NonNullable<Options['remarkPlugins']> = [remarkGfm, remarkMath, remarkCallouts, remarkCodeFenceTitle];
const STREAMING_REHYPE_PLUGINS: NonNullable<Options['rehypePlugins']> = [rehypeOpenFence, [rehypeHighlight, { ...highlightOptions, detect: false }]];
const FULL_REHYPE_PLUGINS: NonNullable<Options['rehypePlugins']> = [rehypeKatex, [rehypeHighlight, { ...highlightOptions, detect: true }]];

const CALLOUT_ICONS: Record<CalloutKind, IconName> = {
  note: 'info', tip: 'spark', important: 'lightning', warning: 'warning', caution: 'error',
};

/** Session artifacts and Windows paths survive the URL filter for images only; they resolve through the media channel. */
const urlTransform: NonNullable<Options['urlTransform']> = (url, key) => (
  key === 'src' && (isSessionArtifactUri(url) || /^[a-z]:[\\/]/i.test(url)) ? url : defaultUrlTransform(url)
);

type CodeElement = React.ReactElement<{ className?: string; children?: React.ReactNode }>;
type PreNode = { children?: Array<{ tagName?: string; data?: { meta?: unknown } }> };

const Callout: React.FC<{ kind: CalloutKind; children: React.ReactNode }> = ({ kind, children }) => {
  const { t } = useI18n();
  return (
    <div className={`markdown-callout is-${kind}`} role="note">
      <span className="markdown-callout-title"><Icon name={CALLOUT_ICONS[kind]} size={16} />{t(`chat.markdownCallout.${kind}`)}</span>
      {children}
    </div>
  );
};

function createMarkdownComponents(renderImage: MessageMarkdownProps['renderImage'], interactive: boolean): Components {
  return {
    a: (props) => (interactive ? <MarkdownLink {...props} /> : <span>{props.children}</span>),
    img: ({ src, alt }) => {
      const source = typeof src === 'string' ? src : undefined;
      if (renderImage) return renderImage({ src: source, alt });
      return interactive ? <MarkdownMedia src={source} alt={alt} /> : null;
    },
    blockquote: ({ children, ...props }) => {
      const kind = (props as Record<string, unknown>)['data-callout'] as CalloutKind | undefined;
      return kind ? <Callout kind={kind}>{children}</Callout> : <blockquote>{children}</blockquote>;
    },
    table: ({ children }) => (
      <div className="markdown-table-scroll">
        <table>{children}</table>
      </div>
    ),
    input: (props) => {
      if (props.type === 'checkbox') {
        return (
          <input
            type="checkbox"
            className="markdown-task-checkbox"
            checked={Boolean(props.checked)}
            disabled
            readOnly
          />
        );
      }
      return <input {...props} />;
    },
    pre: ({ children, node }) => {
      if (!interactive) return <pre>{children}</pre>;
      const codeElement = React.Children.toArray(children).find(
        (child): child is CodeElement => React.isValidElement(child) && child.type === 'code',
      );
      if (!codeElement) return <pre>{children}</pre>;

      const { className, children: codeChildren } = codeElement.props;
      const streamedLanguage = (codeElement.props as Record<string, unknown>)['data-language'];
      const meta = (node as PreNode | undefined)?.children?.find((child) => child.tagName === 'code')?.data?.meta;
      const fence = parseCodeFence(className, meta);
      const language = fence.language || (typeof streamedLanguage === 'string' ? streamedLanguage : '');
      const code = flattenMarkdownText(codeChildren).replace(/\n$/, '');

      if (language === 'mermaid') return <MarkdownMermaid source={code} />;
      return (
        <MarkdownCodeBlock language={language} fileName={fence.fileName} code={code}>
          <code className={className}>{codeChildren}</code>
        </MarkdownCodeBlock>
      );
    },
  };
}

/**
 * Shared Markdown renderer for assistant answers, Work Process commentary, Plan previews, optional user bubbles,
 * Composer preview and knowledge cards.
 *
 * Raw HTML stays disabled (react-markdown default). Links to pages the turn read render as citation pills; other
 * links open outside the app. Images and video resolve through controlled channels into object URLs. Mermaid and KaTeX
 * are opt-in via fenced / math syntax.
 */
const MessageMarkdownInner: React.FC<MessageMarkdownProps> = ({
  content,
  deferHeavyPlugins = false,
  renderImage,
  interactive = true,
}) => {
  const { t } = useI18n();
  const normalized = useMemo(() => normalizeAssistantMarkdown(content), [content]);
  const components = useMemo(() => createMarkdownComponents(renderImage, interactive), [renderImage, interactive]);
  const remarkRehypeOptions = useMemo(() => ({
    footnoteLabel: t('chat.markdownFootnotes'),
    footnoteBackLabel: t('chat.markdownFootnoteBack'),
  }), [t]);

  return (
    <div className="markdown-body">
      <MarkdownGallery>
        <Markdown
          remarkPlugins={deferHeavyPlugins ? STREAMING_REMARK_PLUGINS : FULL_REMARK_PLUGINS}
          rehypePlugins={deferHeavyPlugins ? STREAMING_REHYPE_PLUGINS : FULL_REHYPE_PLUGINS}
          components={components}
          urlTransform={urlTransform}
          remarkRehypeOptions={remarkRehypeOptions}
        >
          {normalized}
        </Markdown>
      </MarkdownGallery>
    </div>
  );
};

export const MessageMarkdown = React.memo(MessageMarkdownInner);

export default MessageMarkdown;
