import React, { useState } from 'react';
import { localizedTranslator } from '../i18n/messages';
import { useClipboardBridge } from '../hooks/useClipboardBridge';
import { useWindowControls } from '../hooks/useWindowControls';
import { formatDiagnostics, type DiagnosticFact } from '../patterns/CopyDiagnostics';
import { WindowControls } from '../shell/TitleBar/WindowControls';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { useCopyFeedback } from '../ui/CopyButton';
import type { AppLanguage } from '@shared/types/settings';
import './RendererFailurePage.css';

export interface RendererFailurePageProps {
  language: AppLanguage;
  /** `crash`: the renderer died twice within a minute; `exception`: a render-time exception reached the root. */
  kind: 'crash' | 'exception';
  facts: readonly DiagnosticFact[];
  onReload: () => void;
}

/**
 * The page a renderer shows when it cannot show the workbench. It reads nothing from main beyond its entry URL, so it
 * renders even when the cause is in the state the workbench would load; the window stays movable and closable.
 */
export const RendererFailurePage: React.FC<RendererFailurePageProps> = ({ language, kind, facts, onReload }) => {
  const t = localizedTranslator(language);
  const { copyText } = useClipboardBridge();
  const { copied, copy } = useCopyFeedback(() => copyText(formatDiagnostics(facts)));
  const [maximized, setMaximized] = useState(false);
  const { handleWindowMinimize, handleWindowToggleMaximize, handleWindowClose } = useWindowControls(setMaximized);
  return (
    <main className="renderer-failure-page" data-testid="renderer-failure-page">
      <div className="renderer-failure-titlebar">
        <WindowControls
          maximized={maximized}
          labels={{
            group: t('app.windowControls'),
            minimize: t('app.windowMinimize'),
            maximize: t('app.windowMaximize'),
            restore: t('app.windowRestore'),
            close: t('app.windowClose'),
          }}
          onMinimize={handleWindowMinimize}
          onToggleMaximize={handleWindowToggleMaximize}
          onClose={handleWindowClose}
        />
      </div>
      <EmptyState
        variant="page"
        role="alert"
        title={t('app.rendererFailureTitle')}
        description={t(kind === 'crash' ? 'app.rendererFailureCrashed' : 'app.rendererFailureException')}
        actions={
          <>
            <Button variant="primary" onClick={onReload} data-testid="renderer-failure-reload">
              {t('app.rendererFailureReload')}
            </Button>
            <Button variant="secondary" onClick={() => void copy()} data-testid="renderer-failure-copy">
              {copied ? t('app.copied') : t('app.copyDetails')}
            </Button>
          </>
        }
      />
    </main>
  );
};
