import { DeviceSelector } from '../features/captures/DeviceSelector';
import { useI18n } from '../i18n';

interface WorkbenchUtilitiesProps {
  isTerminalOpen: boolean;
  activityAlertSeverity: 'error' | 'warning' | 'running' | null;
  onToggleTerminal: () => void;
}

/** Title-bar utilities: the replay device and the terminal drawer. */
export function WorkbenchUtilities({ isTerminalOpen, activityAlertSeverity, onToggleTerminal }: WorkbenchUtilitiesProps) {
  const { t } = useI18n();
  const label = isTerminalOpen ? t('terminal.close') : t('terminal.open');
  return (
    <div className="titlebar-utilities">
      <DeviceSelector />
      <button
        type="button"
        className={`main-utility-toggle terminal-pill${isTerminalOpen ? ' is-active' : ''}${activityAlertSeverity ? ` terminal-${activityAlertSeverity}` : ''}`}
        onClick={onToggleTerminal}
        data-testid="terminal-toggle"
        aria-label={label}
        aria-pressed={isTerminalOpen}
        title={label}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M4 17l6-6-6-6" />
          <path d="M12 19h8" />
        </svg>
        {activityAlertSeverity && <span className={`terminal-status-badge ${activityAlertSeverity}`} aria-hidden="true" />}
      </button>
    </div>
  );
}
