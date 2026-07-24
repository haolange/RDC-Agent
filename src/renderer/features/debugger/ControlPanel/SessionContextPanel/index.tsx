import React from 'react';
import { SessionContextActions } from './SessionContextActions';
import { SessionContextOpenedState } from './SessionContextOpenedState';
import { SessionContextQuickEntry } from './SessionContextQuickEntry';
import { useSessionContextPanel } from './useSessionContextPanel';

export { getSessionContextSummary } from './sessionContextFormatters';

export const SessionContextPanel: React.FC = () => {
  const vm = useSessionContextPanel();
  const { t, activeOpenedCapture, currentRun, errorMessage, statusMessage } = vm;

  return (
    <div className="session-context-panel" data-testid="session-context-panel">
      {activeOpenedCapture ? (
        <SessionContextOpenedState vm={vm} />
      ) : (
        <div className="session-context-quick-entry">
          <SessionContextQuickEntry vm={vm} />
        </div>
      )}

      {statusMessage ? (
        <div className="capture-library-status" role="status" aria-live="polite">
          {statusMessage}
        </div>
      ) : null}
      {errorMessage ? (
        <div className="capture-library-error" role="alert" data-testid="session-context-open-error">
          {errorMessage}
        </div>
      ) : null}
      {currentRun && (
        <div className="capture-library-run-lock" role="status" aria-live="polite">
          {t('control.captureSwitchLocked')}
        </div>
      )}

      <SessionContextActions vm={vm} />
    </div>
  );
};

export default SessionContextPanel;
