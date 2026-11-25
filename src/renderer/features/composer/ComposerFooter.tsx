import React from 'react';
import { ContextUsageIndicator } from '../../patterns/ContextUsageIndicator';
import { useComposerSessionContextStore } from '../../stores/composerSessionContextStore';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { IconButton } from '../../ui/IconButton';
import { Spinner } from '../../ui/Spinner';
import { PermissionModeSelector, PermissionSwitchNotice } from './PermissionModeSelector';
import { ComposerModelEffortControl } from './ComposerModelEffortControl';
import { ComposerAgentMenu } from './ComposerAgentMenu';
import { useComposerMenu } from './useComposerMenuRegistry';
import { useComposerView } from './ComposerControllerContext';

function RegisteredContextUsageIndicator(
  props: Omit<React.ComponentProps<typeof ContextUsageIndicator>, 'menu' | 'detailsExpanded' |
    'detailsSaveError' | 'onDetailsExpandedChange'>,
): React.ReactElement {
  const menu = useComposerMenu('usage');
  const detailsExpanded = useAppSettingsStore((state) => (
    state.contextBreakdownPreference?.expanded ?? state.settings.appearance.contextBreakdownExpanded
  ));
  const detailsSaveError = useAppSettingsStore((state) => state.contextBreakdownPreference?.error);
  const setDetailsExpanded = useAppSettingsStore((state) => state.setContextBreakdownExpanded);
  return (
    <ContextUsageIndicator {...props} menu={menu} detailsExpanded={detailsExpanded} detailsSaveError={detailsSaveError}
      onDetailsExpandedChange={(expanded) => { void setDetailsExpanded(expanded); }} />
  );
}

export function ComposerFooter() {
  const { composer, currentSession, transitionLabel } = useComposerView();
  const {
    selectedAgentId, lastKnownUsage, usageEstimated, usageStale, preparedTurnContext, conversationPreparationPhase,
    selectedContextProfile, isComposerBusy, stopPending, attachButtonLabel, primaryButtonDisabled,
    primaryButtonDescription, handlePrimaryStop, handleAttachmentSelect, handlePromptSend,
  } = composer;
  const handingOff = useComposerSessionContextStore(state => !!state.handoffSuggestionRequest);
  // From the Stop click until main answers, the button stays Stop and shows that it is stopping.
  const stopSlot = isComposerBusy || stopPending;
  return (
    <>
      <PermissionSwitchNotice />
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
          <ComposerAgentMenu />
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
          />
          <span role="status" className="composer-transition-announcement">{transitionLabel}</span>
          <Button
            variant={stopSlot ? 'danger' : 'primary'}
            size="sm"
            className={`chat-send-button${stopPending ? ' is-pending' : ''}`}
            data-testid={stopSlot ? 'debugger-stop-button' : 'debugger-start-button'}
            onClick={() => void (isComposerBusy ? handlePrimaryStop() : handlePromptSend())}
            disabled={primaryButtonDisabled}
            aria-busy={stopPending || undefined}
            aria-label={primaryButtonDescription}
            data-tooltip={[transitionLabel, primaryButtonDescription].filter(Boolean).join(' · ')}
          >
            {stopPending ? <Spinner size="sm" /> : isComposerBusy ? (
              <Icon name="stop" filled />
            ) : (
              <Icon name="arrow-up" />
            )}
          </Button>
        </div>
      </div>
    </>
  );
}
