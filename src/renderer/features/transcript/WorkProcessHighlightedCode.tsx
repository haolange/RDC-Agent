import React, { useMemo } from 'react';
import { hljs } from '../../patterns/Markdown/markdownHighlight';

export const WorkProcessHighlightedCode: React.FC<{
  code: string;
  language?: string;
  collapsed?: boolean;
}> = ({ code, language = 'python', collapsed = false }) => {
  const source = collapsed ? code.split('\n').slice(0, 3).join('\n') : code;
  const html = useMemo(() => {
    try {
      return hljs.highlight(source, { language, ignoreIllegals: true }).value;
    } catch {
      return hljs.highlightAuto(source).value;
    }
  }, [language, source]);

  return (
    <pre className={`work-process-highlighted-code${collapsed ? ' is-collapsed' : ''}`}>
      <code
        className={`hljs language-${language}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </pre>
  );
};
