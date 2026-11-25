import { DeviceSelector } from '../features/captures/DeviceSelector';
import { useI18n } from '../i18n';
import { Icon } from '../ui/Icon';
import { SetupGuideButton } from './SetupGuideButton';

interface WorkbenchUtilitiesProps {
  isTerminalOpen: boolean;
  activityAlertSeverity: 'error' | 'warning' | 'running' | null;
  onToggleTerminal: () => void;
}

/** Title-bar utilities: the setup guide, the replay device and the terminal drawer. */
export function WorkbenchUtilities({ isTerminalOpen, activityAlertSeverity, onToggleTerminal }: WorkbenchUtilitiesProps) {
  const { t } = useI18n();
  const label = isTerminalOpen ? t('terminal.close') : t('terminal.open');
  return (
    <div className="titlebar-utilities">
      <SetupGuideButton />
      <DeviceSelector />
      <button
        type="button"
        className={`main-utility-toggle terminal-pill${isTerminalOpen ? ' is-active' : ''}${activityAlertSeverity ? ` terminal-${activityAlertSeverity}` : ''}`}
        onClick={onToggleTerminal}
        data-testid="terminal-toggle"
        aria-label={label}
        aria-pressed={isTerminalOpen}
        data-tooltip={label}
      >
        <Icon name="terminal" />
        {activityAlertSeverity && <span className={`terminal-status-badge ${activityAlertSeverity}`} aria-hidden="true" />}
      </button>
    </div>
  );
}
