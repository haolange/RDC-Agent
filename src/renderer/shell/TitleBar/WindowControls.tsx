import { Icon } from '../../ui/Icon';

export interface WindowControlsProps {
  maximized: boolean;
  labels: { group: string; minimize: string; maximize: string; restore: string; close: string };
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
}

/** Frameless window buttons, shared by the title bar and the boot screen so the window can always move and close. */
export function WindowControls({ maximized, labels, onMinimize, onToggleMaximize, onClose }: WindowControlsProps) {
  const maximizeLabel = maximized ? labels.restore : labels.maximize;
  return (
    <div className="window-controls" role="group" aria-label={labels.group}>
      <button
        type="button"
        className="window-control window-control-minimize"
        data-tooltip={labels.minimize}
        aria-label={labels.minimize}
        onClick={onMinimize}
      >
        <Icon name="window-minimize" />
      </button>
      <button
        type="button"
        className="window-control window-control-maximize"
        data-tooltip={maximizeLabel}
        aria-label={maximizeLabel}
        onClick={onToggleMaximize}
      >
        <Icon name={maximized ? 'window-restore' : 'window-maximize'} />
      </button>
      <button
        type="button"
        className="window-control close"
        data-tooltip={labels.close}
        aria-label={labels.close}
        onClick={onClose}
      >
        <Icon name="close" />
      </button>
    </div>
  );
}
