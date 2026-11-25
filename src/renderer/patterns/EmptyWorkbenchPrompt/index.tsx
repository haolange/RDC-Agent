import React from 'react';
import { resolveAgentDisplay } from '@shared/constants/agents';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { useProjectStore } from '../../stores/projectStore';
import { useI18n, type TranslationKey } from '../../i18n';
import { useDynStyle } from '../../lib/useDynStyle';
import { ModeGlyph } from '../../ui/ModeGlyph';
import { SetupChecklist } from '../SetupChecklist';
import type { WorkbenchSetupStep } from '../../hooks/useWorkbenchSetup';
import type { AgentManifestDefinition } from '@shared/types/agentManifest';
import type { AgentMode } from '@shared/types/layout';
import './EmptyWorkbenchPrompt.css';

interface EmptyWorkbenchPromptProps {
  mode: AgentMode;
  /** First-run steps from live configuration; shown until every one is done. */
  setup: WorkbenchSetupStep[];
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

const EmptyToolCard: React.FC<{
  toolMode: FocusMode;
  agentDefinitions: AgentManifestDefinition[];
}> = ({ toolMode, agentDefinitions }) => {
  const { t } = useI18n();
  const dynStyle = useDynStyle({
    '--empty-card-accent': resolveAgentDisplay(toolMode, agentDefinitions).accent,
  });

  return (
    <article
      className={`empty-workbench-tool-card mode-${toolMode}`}
      data-testid={`empty-workbench-tool-${toolMode}`}
      {...dynStyle}
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
  );
};

export const EmptyWorkbenchPrompt: React.FC<EmptyWorkbenchPromptProps> = ({ mode, setup }) => {
  const { t } = useI18n();
  const currentProject = useProjectStore((state) => state.currentProject);
  const agentDefinitions = useAppSettingsStore((state) => state.settings.agents.definitions);

  const variant: EmptyVariant = currentProject ? 'session-empty' : 'no-project';
  const setupPending = setup.some((step) => !step.done);

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

        {setupPending ? <SetupChecklist steps={setup} /> : (
          <div className="empty-workbench-tool-grid" aria-label={t('emptyWorkbench.toolsLabel')}>
            {FOCUS_MODES.map((toolMode: FocusMode) => (
              <EmptyToolCard
                key={toolMode}
                toolMode={toolMode}
                agentDefinitions={agentDefinitions}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

export default EmptyWorkbenchPrompt;
