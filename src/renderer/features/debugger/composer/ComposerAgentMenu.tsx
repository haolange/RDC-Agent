import React from 'react';
import { ModeGlyph } from '../../../ui/ModeGlyph';
import type { AgentMode } from '@shared/types/layout';
import type { AgentManifestDefinition } from '@shared/types/agentManifest';
import type { ModeConfig } from '@shared/types/layout';

export const ComposerAgentMenu: React.FC<{
  modeMenuRef: React.Ref<HTMLDivElement>;
  modeMenuOpen: boolean;
  setModeMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  currentMode: AgentMode;
  currentModeConfig: ModeConfig;
  currentModeLabel: string;
  selectedAgentId: string;
  selectedAgentDefinition: AgentManifestDefinition | undefined;
  selectedAgentCapability: string;
  userInvocableAgents: AgentManifestDefinition[];
  activeAgentId: string | null;
  setSelectedAgentId: (agentId: string) => void;
  setCurrentMode: (mode: AgentMode) => void;
}> = ({
  modeMenuRef,
  modeMenuOpen,
  setModeMenuOpen,
  currentMode,
  currentModeConfig,
  currentModeLabel,
  selectedAgentId,
  selectedAgentDefinition,
  selectedAgentCapability,
  userInvocableAgents,
  activeAgentId,
  setSelectedAgentId,
  setCurrentMode,
}) => (
  <div ref={modeMenuRef} className="composer-agent-menu">
    <button
      type="button"
      className={`composer-agent-pill ${modeMenuOpen ? 'open' : ''}`}
      data-testid="composer-mode-pill"
      onClick={() => setModeMenuOpen((current) => !current)}
      aria-haspopup="menu"
      aria-expanded={modeMenuOpen}
      title={selectedAgentCapability || currentModeLabel}
    >
      <span className="composer-agent-pill-icon" aria-hidden="true">
        <ModeGlyph mode={currentMode} icon={selectedAgentDefinition?.icon ?? currentModeConfig.icon} size={16} strokeWidth={2} />
      </span>
      <span className="composer-agent-pill-label">{currentModeLabel}</span>
      <span className="composer-agent-pill-caret" aria-hidden="true">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </span>
    </button>
    {modeMenuOpen && (
      <div className="composer-agent-menu-popup" role="menu">
        {userInvocableAgents.map((agent) => {
          const agentMode: AgentMode = agent.id;
          return (
            <button
              key={agent.id}
              type="button"
              className={`composer-agent-menu-item ${selectedAgentId === agent.id ? 'active' : ''}`}
              data-testid={`mode-menu-item-${agent.id}`}
              role="menuitemradio"
              aria-checked={selectedAgentId === agent.id}
              onClick={() => {
                setSelectedAgentId(agent.id);
                setCurrentMode(agentMode);
                setModeMenuOpen(false);
              }}
            >
              <span className="composer-agent-menu-item-copy">
                <span className="composer-agent-menu-item-icon" aria-hidden="true">
                  <ModeGlyph mode={agentMode} icon={agent.icon ?? undefined} size={16} strokeWidth={2} />
                </span>
                <span className="composer-agent-menu-item-label">{agent.name}</span>
                {activeAgentId === agent.id ? (
                  <span className="composer-agent-status-dot is-active" aria-label="Active" />
                ) : null}
              </span>
              {agent.description ? (
                <span className="composer-agent-menu-item-tooltip" role="tooltip">
                  {agent.description}
                </span>
              ) : null}
              {selectedAgentId === agent.id ? <span className="composer-agent-menu-item-check">✓</span> : null}
            </button>
          );
        })}
      </div>
    )}
  </div>
);
