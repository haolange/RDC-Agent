import React from 'react';
import type { AgentMode } from '@shared/types/layout';
import { AGENT_MODES } from '@shared/constants/agents';
import { useI18n, type TranslationKey } from '../../i18n';
import { ModeGlyph } from '../../ui/ModeGlyph';
import './EmptyWorkbenchPrompt.css';

interface EmptyWorkbenchPromptProps {
  mode: AgentMode;
}

const CARD_COPY: Record<AgentMode, { title: TranslationKey; subtitle: TranslationKey }> = {
  ask: {
    title: 'emptyWorkbench.askTitle',
    subtitle: 'emptyWorkbench.askSubtitle',
  },
  debugger: {
    title: 'emptyWorkbench.debuggerTitle',
    subtitle: 'emptyWorkbench.debuggerSubtitle',
  },
  analyzer: {
    title: 'emptyWorkbench.analyzerTitle',
    subtitle: 'emptyWorkbench.analyzerSubtitle',
  },
  optimizer: {
    title: 'emptyWorkbench.optimizerTitle',
    subtitle: 'emptyWorkbench.optimizerSubtitle',
  },
};

export const EmptyWorkbenchPrompt: React.FC<EmptyWorkbenchPromptProps> = ({ mode }) => {
  const { t } = useI18n();

  return (
    <section
      className="empty-workbench-prompt"
      data-testid="empty-workbench-prompt"
      data-active-mode={mode}
    >
      <div className="empty-workbench-content">
        <div className="empty-workbench-heading">
          <h1 className="empty-workbench-title debugger-idle-simple-title">{t('emptyWorkbench.title')}</h1>
          <p className="empty-workbench-subtitle debugger-idle-description">{t('emptyWorkbench.subtitle')}</p>
        </div>

        <div className="empty-workbench-tool-grid" aria-label={t('emptyWorkbench.toolsLabel')}>
          {AGENT_MODES.map((toolMode) => (
            <article
              key={toolMode.id}
              className={`empty-workbench-tool-card mode-${toolMode.id}`}
              data-testid={`empty-workbench-tool-${toolMode.id}`}
              style={{ ['--empty-card-accent' as string]: toolMode.accentColor }}
            >
              <div className="empty-workbench-tool-visual" aria-hidden="true">
                <div className="empty-workbench-tool-rings" />
                <div className="empty-workbench-tool-core">
                  <ModeGlyph
                    mode={toolMode.id}
                    className="empty-workbench-tool-icon"
                    size={30}
                    strokeWidth={1.75}
                  />
                </div>
              </div>
              <div className="empty-workbench-tool-copy">
                <div className="empty-workbench-tool-kicker">
                  <ModeGlyph
                    mode={toolMode.id}
                    className="empty-workbench-tool-kicker-icon"
                    size={13}
                    strokeWidth={1.9}
                  />
                  <span>{t(`mode.${toolMode.id}`)}</span>
                </div>
                <h2 className="empty-workbench-tool-title">{t(CARD_COPY[toolMode.id].title)}</h2>
                <p className="empty-workbench-tool-subtitle">{t(CARD_COPY[toolMode.id].subtitle)}</p>
              </div>
              <div className="empty-workbench-tool-edge" aria-hidden="true" />
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};

export default EmptyWorkbenchPrompt;
