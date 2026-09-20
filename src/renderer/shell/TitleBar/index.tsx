import type { ReactNode } from 'react';
import { IconButton } from '../../ui/IconButton';
import { Icon } from '../../ui/Icon';
import './TitleBar.css';

export interface TitleBarProps {
  onGettingStarted?: () => void;
  gettingStartedLabel?: string;
  effectiveLeftCollapsed: boolean;
  effectiveRightCollapsed: boolean;
  isRightRailVisible: boolean;
  leftToggleDisabled: boolean;
  rightToggleDisabled: boolean;
  leftPanelToggleLabel: string;
  rightPanelToggleLabel: string;
  autoCollapsedTitle: string;
  windowMaximized: boolean;
  windowControlsLabel: string;
  windowMinimizeLabel: string;
  windowMaximizeLabel: string;
  windowRestoreLabel: string;
  windowCloseLabel: string;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
  logo?: ReactNode;
}

export function TitleBar({
  onGettingStarted,
  gettingStartedLabel,
  effectiveLeftCollapsed,
  effectiveRightCollapsed,
  isRightRailVisible,
  leftToggleDisabled,
  rightToggleDisabled,
  leftPanelToggleLabel,
  rightPanelToggleLabel,
  autoCollapsedTitle,
  windowMaximized,
  windowControlsLabel,
  windowMinimizeLabel,
  windowMaximizeLabel,
  windowRestoreLabel,
  windowCloseLabel,
  onToggleLeft,
  onToggleRight,
  onMinimize,
  onToggleMaximize,
  onClose,
  logo,
}: TitleBarProps) {
  return (
    <header className="app-titlebar">
      <div className="app-titlebar-left no-drag">
        {logo ?? (
          <div className="app-logo">
            <div className="app-logo-icon">RD</div>
            <div className="app-logo-copy">
              <span className="app-logo-text">RDC-Agent</span>
            </div>
          </div>
        )}
        <button
          type="button"
          className="shell-panel-toggle titlebar-panel-toggle"
          data-testid="titlebar-left-panel-toggle"
          onClick={!leftToggleDisabled ? onToggleLeft : undefined}
          aria-label={leftPanelToggleLabel}
          title={leftToggleDisabled ? autoCollapsedTitle : leftPanelToggleLabel}
          disabled={leftToggleDisabled}
        >
          <span className="shell-panel-toggle-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {effectiveLeftCollapsed ? (
                <polyline points="9 18 15 12 9 6" />
              ) : (
                <polyline points="15 6 9 12 15 18" />
              )}
            </svg>
          </span>
        </button>
      </div>
      <div className="app-titlebar-right no-drag">
        {onGettingStarted && <IconButton label={gettingStartedLabel ?? ''} onClick={onGettingStarted}
          data-testid="titlebar-getting-started"><Icon name="help" size={18} /></IconButton>}
        {isRightRailVisible && (
          <button
            type="button"
            className="shell-panel-toggle titlebar-panel-toggle"
            data-testid="titlebar-right-panel-toggle"
            onClick={!rightToggleDisabled ? onToggleRight : undefined}
            aria-label={rightPanelToggleLabel}
            title={rightToggleDisabled ? autoCollapsedTitle : rightPanelToggleLabel}
            disabled={rightToggleDisabled}
          >
            <span className="shell-panel-toggle-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {effectiveRightCollapsed ? (
                  <polyline points="15 18 9 12 15 6" />
                ) : (
                  <polyline points="9 18 15 12 9 6" />
                )}
              </svg>
            </span>
          </button>
        )}
        <div className="window-controls" role="group" aria-label={windowControlsLabel}>
          <button
            type="button"
            className="window-control window-control-minimize tooltip"
            data-tooltip={windowMinimizeLabel}
            aria-label={windowMinimizeLabel}
            onClick={onMinimize}
          >
            <span className="minimize" />
          </button>
          <button
            type="button"
            className="window-control window-control-maximize tooltip"
            data-tooltip={windowMaximized ? windowRestoreLabel : windowMaximizeLabel}
            aria-label={windowMaximized ? windowRestoreLabel : windowMaximizeLabel}
            onClick={onToggleMaximize}
          >
            <span className={windowMaximized ? 'restore' : 'maximize'} />
          </button>
          <button
            type="button"
            className="window-control close tooltip"
            data-tooltip={windowCloseLabel}
            aria-label={windowCloseLabel}
            onClick={onClose}
          >
            <span className="close-mark" />
          </button>
        </div>
      </div>
    </header>
  );
}
