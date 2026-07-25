import React, { useMemo } from 'react';
import Markdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import { normalizeAssistantMarkdown } from './normalizeAssistantMarkdown';
import { MarkdownCodeBlock } from './MarkdownCodeBlock';
import { MarkdownMermaid } from './MarkdownMermaid';
import { flattenMarkdownText } from './markdownText';
import './markdownHighlight';
import 'katex/dist/katex.min.css';

interface MessageMarkdownProps {
  content: string;
}

function isLanguageClass(className: unknown): string | null {
  if (typeof className !== 'string') {
    return null;
  }
  const match = /language-([\w#+-]+)/.exec(className);
  return match?.[1] ?? null;
}

const markdownComponents: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
  img: ({ src, alt }) => (
    <img
      src={src}
      alt={alt ?? ''}
      className="markdown-body-img"
      loading="lazy"
      referrerPolicy="no-referrer"
    />
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
  pre: ({ children }) => {
    const childArray = React.Children.toArray(children);
    const codeElement = childArray.find(
      (child): child is React.ReactElement<{ className?: string; children?: React.ReactNode }> =>
        React.isValidElement(child) && child.type === 'code',
    );

    if (!codeElement) {
      return <pre>{children}</pre>;
    }

    const language = isLanguageClass(codeElement.props.className) ?? '';
    const code = flattenMarkdownText(codeElement.props.children).replace(/\n$/, '');

    if (language === 'mermaid') {
      return <MarkdownMermaid source={code} />;
    }

    return (
      <MarkdownCodeBlock language={language} code={code}>
        <code className={codeElement.props.className}>{codeElement.props.children}</code>
      </MarkdownCodeBlock>
    );
  },
};

/**
 * Shared Markdown renderer for assistant answers, Work Process commentary,
 * Plan previews, optional user bubbles, and Composer preview.
 *
 * Raw HTML stays disabled (react-markdown default). External links open in a
 * new window. Mermaid and KaTeX are opt-in via fenced / math syntax.
 */
const MessageMarkdownInner: React.FC<MessageMarkdownProps> = ({ content }) => {
  const normalized = useMemo(() => normalizeAssistantMarkdown(content), [content]);

  return (
    <div className="markdown-body">
      <Markdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          rehypeKatex,
          [rehypeHighlight, { detect: true, ignoreMissing: true }],
        ]}
        components={markdownComponents}
      >
        {normalized}
      </Markdown>
    </div>
  );
};

export const MessageMarkdown = React.memo(MessageMarkdownInner);

export default MessageMarkdown;
