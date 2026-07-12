import React, { useEffect, useId, useState } from 'react';
import { useI18n } from '../../../i18n';

interface MarkdownMermaidProps {
  source: string;
}

type MermaidState =
  | { status: 'loading' }
  | { status: 'ready'; svg: string }
  | { status: 'error'; message: string };

/**
 * Lazily render a Mermaid diagram. Fail-closed: show source + error on parse/render failure.
 * Incomplete streaming fences should not reach here (caller only passes closed fences).
 */
export const MarkdownMermaid: React.FC<MarkdownMermaidProps> = ({ source }) => {
  const { t } = useI18n();
  const reactId = useId().replace(/:/g, '');
  const [state, setState] = useState<MermaidState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    const renderId = `mermaid-${reactId}`;

    void (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: document.documentElement.dataset.resolvedTheme === 'light' ? 'default' : 'dark',
        });
        const { svg } = await mermaid.render(renderId, source);
        if (!cancelled) {
          setState({ status: 'ready', svg });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [reactId, source]);

  if (state.status === 'ready') {
    return (
      <div
        className="markdown-mermaid"
        data-testid="markdown-mermaid"
        // Mermaid returns sanitized SVG under securityLevel: 'strict'.
        dangerouslySetInnerHTML={{ __html: state.svg }}
      />
    );
  }

  return (
    <div className="markdown-mermaid markdown-mermaid-fallback" data-testid="markdown-mermaid-fallback">
      {state.status === 'error' ? (
        <p className="markdown-mermaid-error" role="status">
          {t('chat.markdownMermaidFailed')}: {state.message}
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
