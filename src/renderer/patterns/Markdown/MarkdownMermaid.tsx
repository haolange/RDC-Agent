import React, { useEffect, useId } from 'react';
import { useResolvedTheme } from '../../lib/useResolvedTheme';
import { useI18n } from '../../i18n';
import { errorDetail } from '../../lib/errorDetail';
import { useAsyncValue } from '../../lib/useAsyncValue';
import { extractMermaidStyles, useAdoptedStyles } from './mermaidStyles';

interface MarkdownMermaidProps {
  source: string;
}

/**
 * Lazily render a Mermaid diagram. Fail-closed: show source + error on parse/render failure.
 * Incomplete streaming fences should not reach here (caller only passes closed fences).
 */
export const MarkdownMermaid: React.FC<MarkdownMermaidProps> = ({ source }) => {
  const { t } = useI18n();
  const reactId = useId().replace(/:/g, '');
  const theme = useResolvedTheme();
  const renderId = `mermaid-${reactId}`;
  const state = useAsyncValue(JSON.stringify([renderId, theme, source]), async () => {
    const mermaid = (await import('mermaid')).default;
    // Labels are measured before the diagram's styles apply, so both use the transcript's own font.
    const { fontFamily, fontSize } = getComputedStyle(document.body);
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: theme === 'light' ? 'default' : 'dark',
      fontFamily,
      themeVariables: { fontFamily, fontSize },
    });
    const { svg } = await mermaid.render(renderId, source);
    return extractMermaidStyles(svg, renderId);
  });
  const failed = state.status === 'error';
  useEffect(() => {
    if (state.status === 'error') console.error('[markdown] mermaid render failed', errorDetail(state.error));
  }, [state]);
  useAdoptedStyles(state.status === 'ready' ? state.value.css : '');

  if (state.status === 'ready') {
    return (
      <div
        className="markdown-mermaid"
        data-testid="markdown-mermaid"
        // Mermaid returns sanitized SVG under securityLevel: 'strict'; its styles were moved into an adopted sheet.
        dangerouslySetInnerHTML={{ __html: state.value.svg }}
      />
    );
  }

  return (
    <div className="markdown-mermaid markdown-mermaid-fallback" data-testid="markdown-mermaid-fallback">
      {failed ? (
        <p className="markdown-mermaid-error" role="status">
          {t('chat.markdownMermaidFailed')}
        </p>
      ) : (
        <p className="markdown-mermaid-loading" role="status">
          {t('chat.markdownMermaidLoading')}
        </p>
      )}
      <pre className="markdown-mermaid-source">
        <code>{source}</code>
      </pre>
    </div>
  );
};

export default MarkdownMermaid;
