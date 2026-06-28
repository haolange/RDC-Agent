import React from 'react';
import type { AgentMode } from '@shared/types/layout';
import { AGENT_COLORS } from '@shared/constants/agents';
import { useProjectStore } from '../../stores/projectStore';
import { useI18n, type TranslationKey } from '../../i18n';
import { ModeGlyph } from '../../ui/ModeGlyph';
import './EmptyWorkbenchPrompt.css';

interface EmptyWorkbenchPromptProps {
  mode: AgentMode;
}

type EmptyVariant = 'no-project' | 'session-empty';

const FOCUS_MODES = ['debugger', 'analyzer', 'optimizer'] as const;
type FocusMode = (typeof FOCUS_MODES)[number];

const CARD_LINE: Record<FocusMode, TranslationKey> = {
  debugger: 'emptyWorkbench.debuggerLine',
  analyzer: 'emptyWorkbench.analyzerLine',
  optimizer: 'emptyWorkbench.optimizerLine',
};

const HERO_COPY: Record<EmptyVariant, { title: TranslationKey; subtitle: TranslationKey }> = {
  'no-project': {
    title: 'emptyWorkbench.noProjectTitle',
    subtitle: 'emptyWorkbench.noProjectSubtitle',
  },
  'session-empty': {
    title: 'emptyWorkbench.sessionTitle',
    subtitle: 'emptyWorkbench.sessionSubtitle',
  },
};

export const EmptyWorkbenchPrompt: React.FC<EmptyWorkbenchPromptProps> = ({ mode }) => {
  const { t } = useI18n();
  const currentProject = useProjectStore((state) => state.currentProject);

  const variant: EmptyVariant = currentProject ? 'session-empty' : 'no-project';

  const hero = HERO_COPY[variant];
  const subtitle = t(hero.subtitle);

  return (
    <section
      className="empty-workbench-prompt"
      data-testid="empty-workbench-prompt"
      data-active-mode={mode}
      data-variant={variant}
    >
      <div className="empty-workbench-content" data-variant={variant}>
        <div className="empty-workbench-heading">
          <h1 className="empty-workbench-title">{t(hero.title)}</h1>
          <p className="empty-workbench-subtitle">{subtitle}</p>
        </div>

        <div className="empty-workbench-tool-grid" aria-label={t('emptyWorkbench.toolsLabel')}>
          {FOCUS_MODES.map((toolMode: FocusMode) => (
            <article
              key={toolMode}
              className={`empty-workbench-tool-card mode-${toolMode}`}
              data-testid={`empty-workbench-tool-${toolMode}`}
              style={{ ['--empty-card-accent' as string]: AGENT_COLORS[toolMode] }}
            >
              <span className="empty-workbench-tool-core" aria-hidden="true">
                <ModeGlyph
                  mode={toolMode}
                  className="empty-workbench-tool-icon"
                  size={22}
                  strokeWidth={1.75}
                />
              </span>
              <span className="empty-workbench-tool-copy">
                <span className="empty-workbench-tool-title">{t(`mode.${toolMode}`)}</span>
                <span className="empty-workbench-tool-subtitle">{t(CARD_LINE[toolMode])}</span>
              </span>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};

export default EmptyWorkbenchPrompt;
