import { getElectronApi } from '../../../../platform/getElectronApi';
import React from 'react';
import type { SessionContextPanelViewModel } from './useSessionContextPanel';

interface SessionContextActionsProps {
  vm: SessionContextPanelViewModel;
}

export const SessionContextActions: React.FC<SessionContextActionsProps> = ({ vm }) => {
  const {
    t,
    isIdleSelectionState,
    handleRefresh,
    contextSnapshot,
    activeOpenedCapture,
    currentRun,
    handleClear,
  } = vm;

  if (isIdleSelectionState) {
    return null;
  }

  return (
    <div className="session-context-actions">
      <button
        type="button"
        className="panel-action-btn"
        data-testid="session-context-refresh"
        onClick={() => void handleRefresh()}
      >
        <span>{t('control.runtimeRefresh')}</span>
      </button>
      <button
        type="button"
        className="panel-action-btn"
        data-testid="session-context-copy-id"
        onClick={() => {
          const contextId = contextSnapshot?.contextId ?? activeOpenedCapture?.contextId;
          if (contextId) {
            void getElectronApi()?.appShell.copyText(contextId);
          }
        }}
        disabled={!contextSnapshot?.contextId && !activeOpenedCapture?.contextId}
      >
        <span>{t('control.copyContextId')}</span>
      </button>
      <button
        type="button"
        className="panel-action-btn session-context-clear-btn"
        data-testid="session-context-clear-opened"
        onClick={() => void handleClear()}
        disabled={!activeOpenedCapture || Boolean(currentRun)}
        title={currentRun ? t('control.captureSwitchLocked') : undefined}
      >
        <span>{t('control.openedCaptureClear')}</span>
      </button>
    </div>
  );
};
