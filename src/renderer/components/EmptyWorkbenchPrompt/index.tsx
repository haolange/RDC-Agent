import React from 'react';
import type { AgentMode } from '@shared/types/layout';
import { getAgentModeConfig } from '@shared/constants/agents';
import { ModeGlyph } from '../ModeGlyph';
import './EmptyWorkbenchPrompt.css';

interface EmptyWorkbenchPromptProps {
  mode: AgentMode;
}

export const EmptyWorkbenchPrompt: React.FC<EmptyWorkbenchPromptProps> = ({ mode }) => {
  const modeConfig = getAgentModeConfig(mode);

  return (
    <section
      className={`empty-workbench-prompt mode-${mode}`}
      data-testid="empty-workbench-prompt"
      style={{ ['--empty-mode-accent' as string]: modeConfig.accentColor }}
    >
      <div className="empty-workbench-content">
        <div className="empty-workbench-monument" aria-hidden="true">
          <div className="empty-workbench-monument-glow" />
          <div className="empty-workbench-monument-orbit orbit-a" />
          <div className="empty-workbench-monument-orbit orbit-b" />
          <div className="empty-workbench-monument-beam" />
          <div className="empty-workbench-monument-core">
            <ModeGlyph mode={mode} className="empty-workbench-monument-icon" size={28} strokeWidth={1.7} />
          </div>
        </div>
        <div className="empty-workbench-copy">
          <div className="empty-workbench-kicker">
            <ModeGlyph mode={mode} className="empty-workbench-kicker-icon" size={14} strokeWidth={1.9} />
            <span>{modeConfig.label}</span>
          </div>
          <h1 className="empty-workbench-title debugger-idle-simple-title">{modeConfig.emptyTitle}</h1>
          <p className="empty-workbench-subtitle debugger-idle-description">{modeConfig.emptySubtitle}</p>
        </div>
      </div>
    </section>
  );
};

export default EmptyWorkbenchPrompt;
