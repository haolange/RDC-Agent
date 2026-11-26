import React, { useMemo } from 'react';
import { useMarkdownEnhancers } from '../../patterns/Markdown/markdownEnhancers';

export const WorkProcessHighlightedCode: React.FC<{
  code: string;
  language?: string;
  collapsed?: boolean;
}> = ({ code, language = 'python', collapsed = false }) => {
  const source = collapsed ? code.split('\n').slice(0, 3).join('\n') : code;
  const enhancers = useMarkdownEnhancers();
  const html = useMemo(() => {
    if (!enhancers) return null;
    try {
      return enhancers.hljs.highlight(source, { language, ignoreIllegals: true }).value;
    } catch {
      return enhancers.hljs.highlightAuto(source).value;
    }
  }, [enhancers, language, source]);

  return (
    <pre className={`work-process-highlighted-code${collapsed ? ' is-collapsed' : ''}`}>
      {html === null ? (
        <code className={`hljs language-${language}`}>{source}</code>
      ) : (
        <code className={`hljs language-${language}`} dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </pre>
  );
};
