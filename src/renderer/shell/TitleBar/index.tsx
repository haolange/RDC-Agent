import { ProductLogo } from '../../ui/ProductLogo';
import { Icon } from '../../ui/Icon';
import { WindowControls } from './WindowControls';
import type { ReactNode } from 'react';
import './TitleBar.css';

export interface TitleBarProps {
  /** Workbench utilities (replay device, terminal) shown before the panel toggles. */
  utilities?: ReactNode;
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
  accent: string;
}

export function TitleBar({
  utilities,
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
  accent,
}: TitleBarProps) {
  return (
    <header className="app-titlebar">
      <div className="app-titlebar-left no-drag">
        <div className="app-logo">
          <ProductLogo accent={accent} />
          <div className="app-logo-copy">
            <span className="app-logo-text">RDC-Agent</span>
          </div>
        </div>
        <button
          type="button"
          className="shell-panel-toggle titlebar-panel-toggle"
          data-testid="titlebar-left-panel-toggle"
          onClick={!leftToggleDisabled ? onToggleLeft : undefined}
          aria-label={leftPanelToggleLabel}
          aria-expanded={!effectiveLeftCollapsed}
          data-tooltip={leftToggleDisabled ? autoCollapsedTitle : leftPanelToggleLabel}
          disabled={leftToggleDisabled}
        >
          <Icon name="sidebar-left" size={18} className="shell-panel-toggle-icon" />
        </button>
      </div>
      <div className="app-titlebar-right no-drag">
        {utilities}
        {isRightRailVisible && (
          <button
            type="button"
            className="shell-panel-toggle titlebar-panel-toggle"
            data-testid="titlebar-right-panel-toggle"
            onClick={!rightToggleDisabled ? onToggleRight : undefined}
            aria-label={rightPanelToggleLabel}
            aria-expanded={!effectiveRightCollapsed}
            data-tooltip={rightToggleDisabled ? autoCollapsedTitle : rightPanelToggleLabel}
            disabled={rightToggleDisabled}
          >
            <Icon name="sidebar-right" size={18} className="shell-panel-toggle-icon" />
          </button>
        )}
        <WindowControls
          maximized={windowMaximized}
          labels={{
            group: windowControlsLabel,
            minimize: windowMinimizeLabel,
            maximize: windowMaximizeLabel,
            restore: windowRestoreLabel,
            close: windowCloseLabel,
          }}
          onMinimize={onMinimize}
          onToggleMaximize={onToggleMaximize}
          onClose={onClose}
        />
      </div>
    </header>
  );
}
