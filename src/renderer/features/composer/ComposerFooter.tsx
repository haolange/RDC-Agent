import React from 'react';
import { ContextUsageIndicator } from '../../patterns/ContextUsageIndicator';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { PermissionModeSelector } from './PermissionModeSelector';
import { ComposerModelEffortControl } from './ComposerModelEffortControl';
import { ComposerAgentMenu } from './ComposerAgentMenu';
import { useComposerMenu } from './useComposerMenuRegistry';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { IconButton } from '../../ui/IconButton';
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
            title={attachButtonLabel}
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
          />
          <RegisteredContextUsageIndicator
            usage={lastKnownUsage}
            prepared={preparedTurnContext}
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
            title={primaryButtonDescription}
          >
            {isComposerBusy ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 19V5m-6 6 6-6 6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </Button>
        </div>
      </div>
  );
}
