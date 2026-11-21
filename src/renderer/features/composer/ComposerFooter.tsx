import React from 'react';
import { ContextUsageIndicator } from '../../patterns/ContextUsageIndicator';
import { useComposerSessionContextStore } from '../../stores/composerSessionContextStore';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { IconButton } from '../../ui/IconButton';
import { PermissionModeSelector } from './PermissionModeSelector';
import { ComposerModelEffortControl } from './ComposerModelEffortControl';
import { ComposerAgentMenu } from './ComposerAgentMenu';
import { useComposerMenu } from './useComposerMenuRegistry';
import type { ComposerController } from './useComposer';

type ComposerFooterProps = Pick<ComposerController,
  'currentMode'
  | 'currentModeConfig'
  | 'currentModeLabel'
  | 'selectedAgentId'
  | 'userInvocableAgents'
  | 'setSelectedAgentId'
  | 'lastKnownUsage'
  | 'usageEstimated'
  | 'usageStale'
  | 'preparedTurnContext'
  | 'conversationPreparationPhase'
  | 'selectedContextProfile'
  | 'isComposerBusy'
  | 'attachButtonLabel'
  | 'primaryButtonDisabled'
  | 'primaryButtonDescription'
  | 'handlePrimaryStop'
  | 'handleAttachmentSelect'
  | 'handlePromptSend'> & Pick<React.ComponentProps<typeof ComposerAgentMenu>,
  'selectedAgentDefinition' | 'selectedAgentCapability' | 'activeAgentId' | 'setCurrentMode'> & {
  currentSession: React.ComponentProps<typeof ComposerModelEffortControl>['currentSession'];
};

function RegisteredContextUsageIndicator(
  props: Omit<React.ComponentProps<typeof ContextUsageIndicator>, 'menu'>,
): React.ReactElement {
  const menu = useComposerMenu('usage');
  return <ContextUsageIndicator {...props} menu={menu} />;
}

export function ComposerFooter({
  currentMode, currentModeConfig, currentModeLabel, selectedAgentId, userInvocableAgents,
  setSelectedAgentId, lastKnownUsage, usageEstimated, usageStale, preparedTurnContext,
  conversationPreparationPhase, selectedContextProfile, isComposerBusy, attachButtonLabel,
  primaryButtonDisabled, primaryButtonDescription, handlePrimaryStop, handleAttachmentSelect,
  handlePromptSend,
  selectedAgentDefinition, selectedAgentCapability, activeAgentId, setCurrentMode, currentSession,
}: ComposerFooterProps) {
  const handingOff = useComposerSessionContextStore(state => !!state.handoffSuggestionRequest);
  const detailsExpanded = useAppSettingsStore((state) => state.settings.appearance.contextBreakdownExpanded);
  const setDetailsExpanded = useAppSettingsStore((state) => state.setContextBreakdownExpanded);
  return (
      <div className="composer-footer-bar" data-testid="composer-footer-bar">
        <div className="composer-toolbar-group composer-toolbar-group-left">
          <IconButton
            className="composer-attach-button"
            data-testid="composer-attach-button"
            size="sm"
            label={attachButtonLabel}
            data-tooltip={attachButtonLabel}
            disabled={isComposerBusy}
            onClick={() => void handleAttachmentSelect()}
          >
            <Icon name="plus" size={14} />
          </IconButton>
          <ComposerAgentMenu
            currentMode={currentMode}
            currentModeConfig={currentModeConfig}
            currentModeLabel={currentModeLabel}
            selectedAgentId={selectedAgentId}
            selectedAgentDefinition={selectedAgentDefinition}
            selectedAgentCapability={selectedAgentCapability}
            userInvocableAgents={userInvocableAgents}
            activeAgentId={activeAgentId}
            setSelectedAgentId={setSelectedAgentId}
            setCurrentMode={setCurrentMode}
          />
          <PermissionModeSelector />
        </div>
        <div className="composer-toolbar-group composer-toolbar-group-right">
          <ComposerModelEffortControl
            agentId={selectedAgentId}
            currentSession={currentSession}
            disabled={isComposerBusy}
            prepared={handingOff && conversationPreparationPhase !== 'preparing' ? null : preparedTurnContext}
            preparing={conversationPreparationPhase === 'preparing'}
          />
          <RegisteredContextUsageIndicator
            usage={lastKnownUsage}
            prepared={handingOff && conversationPreparationPhase !== 'preparing' ? null : preparedTurnContext}
            phase={conversationPreparationPhase}
            selectedProfile={selectedContextProfile}
            stale={usageStale}
            estimated={usageEstimated}
            detailsExpanded={detailsExpanded}
            onDetailsExpandedChange={(expanded) => { void setDetailsExpanded(expanded); }}
          />
          <Button
            variant={isComposerBusy ? 'danger' : 'primary'}
            size="sm"
            className="chat-send-button"
            data-testid={isComposerBusy ? 'debugger-stop-button' : 'debugger-start-button'}
            onClick={() => void (isComposerBusy ? handlePrimaryStop() : handlePromptSend())}
            disabled={primaryButtonDisabled}
            aria-label={primaryButtonDescription}
            data-tooltip={primaryButtonDescription}
          >
            {isComposerBusy ? (
              <Icon name="stop" filled />
            ) : (
              <Icon name="arrow-up" />
            )}
          </Button>
        </div>
      </div>
  );
}
