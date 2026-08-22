import React, { useCallback, useEffect, useRef } from 'react';
import { ModeGlyph } from '../../../ui/ModeGlyph';
import { useI18n } from '../../../i18n';
import type { AgentMode, ModeConfig } from '@shared/types/layout';
import type { AgentManifestDefinition } from '@shared/types/agentManifest';
import { useComposerMenu } from './useComposerMenuRegistry';

export const ComposerAgentMenu: React.FC<{
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
}) => {
  const { t } = useI18n();
  const menu = useComposerMenu('agent');
  const popupRef = useRef<HTMLDivElement>(null);
  const setRootRef = useCallback((node: HTMLDivElement | null) => {
    menu.setRoot(node);
  }, [menu]);
  const setTriggerRef = useCallback((node: HTMLButtonElement | null) => {
    menu.setTrigger(node);
  }, [menu]);

  useEffect(() => {
    if (!menu.open) return;
    const selected = popupRef.current?.querySelector<HTMLButtonElement>('[data-selected="true"]');
    const first = popupRef.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]');
    (selected ?? first)?.focus({ preventScroll: true });
  }, [menu.open]);

  const closeAndRestoreFocus = () => {
    menu.close();
  };

  const selectAgent = (agent: AgentManifestDefinition) => {
    setSelectedAgentId(agent.id);
    setCurrentMode(agent.id);
    closeAndRestoreFocus();
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled)'),
    );
    if (items.length === 0) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      closeAndRestoreFocus();
      return;
    }

    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let targetIndex: number | null = null;
    if (event.key === 'ArrowDown') {
      targetIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
    } else if (event.key === 'ArrowUp') {
      targetIndex = currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
    } else if (event.key === 'Home') {
      targetIndex = 0;
    } else if (event.key === 'End') {
      targetIndex = items.length - 1;
    }

    if (targetIndex != null) {
      event.preventDefault();
      items[targetIndex]?.focus({ preventScroll: true });
    }
  };

  return (
    <div ref={setRootRef} className="composer-agent-menu">
      <button
        ref={setTriggerRef}
        type="button"
        className={`composer-agent-pill ${menu.open ? 'open' : ''}`}
        data-testid="composer-mode-pill"
        onClick={() => menu.toggle()}
        aria-haspopup="menu"
        aria-expanded={menu.open}
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
      {menu.open ? (
        <div
          ref={popupRef}
          className="composer-agent-menu-popup"
          role="menu"
          onKeyDown={handleMenuKeyDown}
        >
          {userInvocableAgents.map((agent) => {
            const agentMode: AgentMode = agent.id;
            const isSelected = selectedAgentId === agent.id;
            const isRunning = activeAgentId === agent.id;
            return (
              <button
                key={agent.id}
                type="button"
                className={`composer-agent-menu-item${isSelected ? ' is-selected' : ''}${isRunning ? ' is-running' : ''}`}
                data-testid={`mode-menu-item-${agent.id}`}
                data-selected={isSelected}
                role="menuitemradio"
                aria-checked={isSelected}
                title={agent.description || agent.name}
                onClick={() => selectAgent(agent)}
              >
                <span className="composer-agent-menu-item-icon" aria-hidden="true">
                  <ModeGlyph mode={agentMode} icon={agent.icon ?? undefined} size={16} strokeWidth={2} />
                </span>
                <span className="composer-agent-menu-item-label">{agent.name}</span>
                <span className="composer-agent-menu-item-running-state">
                  {isRunning ? (
                    <>
                      <span className="composer-agent-menu-item-running-dot" aria-hidden="true" />
                      <span>{t('chat.workProcessStatusRunning')}</span>
                    </>
                  ) : null}
                </span>
                <span className="composer-agent-menu-item-check" aria-hidden="true">
                  {isSelected ? '✓' : ''}
                </span>
                {agent.description ? (
                  <span className="composer-agent-menu-item-tooltip" role="tooltip">
                    {agent.description}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};
