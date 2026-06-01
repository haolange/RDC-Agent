import type { ReactNode } from 'react';
import { PanelZone } from './PanelZone';
import { ResizeHandle } from './ResizeHandle';

export interface WorkbenchLayoutProps {
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  leftWidth: number;
  rightWidth: number;
  isResizing?: boolean;
  resizeDisabled?: { left?: boolean; right?: boolean };
  onResizeStart: (side: 'left' | 'right', baseWidth: number) => void;
  left: ReactNode;
  main: ReactNode;
  right: ReactNode;
}

export function WorkbenchLayout({
  leftCollapsed,
  rightCollapsed,
  leftWidth,
  rightWidth,
  isResizing = false,
  resizeDisabled,
  onResizeStart,
  left,
  main,
  right,
}: WorkbenchLayoutProps) {
  return (
    <div className={`app-body ${isResizing ? 'is-resizing' : ''}`.trim()}>
      <PanelZone side="left" collapsed={leftCollapsed} width={leftWidth} testId="app-sidebar-left">
        {left}
      </PanelZone>
      <ResizeHandle
        side="left"
        disabled={leftCollapsed || resizeDisabled?.left}
        onDragStart={onResizeStart}
      />
      <main className="app-main">{main}</main>
      <ResizeHandle
        side="right"
        disabled={rightCollapsed || resizeDisabled?.right}
        onDragStart={onResizeStart}
      />
      <PanelZone side="right" collapsed={rightCollapsed} width={rightWidth} testId="app-sidebar-right">
        {right}
      </PanelZone>
    </div>
  );
}
