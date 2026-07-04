import React, { useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { normalizeAssistantMarkdown } from './normalizeAssistantMarkdown';
import './markdownHighlight';

interface MessageMarkdownProps {
  content: string;
}

/**
 * 渲染 assistant 正文为正式排版的 Markdown：表格、标题、列表、行内代码、代码块。
 *
 * 不允许原始 HTML（react-markdown 默认即关闭），外链统一在新窗口打开，避免在
 * 渲染进程内整页跳转。
 */
export const MessageMarkdown: React.FC<MessageMarkdownProps> = ({ content }) => {
  const normalized = useMemo(() => normalizeAssistantMarkdown(content), [content]);

  return (
    <div className="markdown-body">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
        }}
      >
        {normalized}
      </Markdown>
    </div>
  );
};

export default MessageMarkdown;
