import { useCallback, useState } from 'react';

export interface ResizablePanelState {
  width: number;
  collapsed: boolean;
  isDragging: boolean;
}

export interface UseResizablePanelOptions {
  initialWidth: number;
  minWidth: number;
  maxWidth: number;
  collapsedWidth?: number;
}

export interface UseResizablePanelResult extends ResizablePanelState {
  setWidth: (width: number) => void;
  setCollapsed: (collapsed: boolean) => void;
  setIsDragging: (isDragging: boolean) => void;
  clampWidth: (width: number) => number;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** Stub hook for panel resize state; wiring to layout persistence is deferred. */
export const useResizablePanel = ({
  initialWidth,
  minWidth,
  maxWidth,
}: UseResizablePanelOptions): UseResizablePanelResult => {
  const [width, setWidthState] = useState(initialWidth);
  const [collapsed, setCollapsed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const clampWidth = useCallback(
    (nextWidth: number) => clamp(nextWidth, minWidth, maxWidth),
    [minWidth, maxWidth],
  );

  const setWidth = useCallback(
    (nextWidth: number) => setWidthState(clampWidth(nextWidth)),
    [clampWidth],
  );

  return {
    width,
    collapsed,
    isDragging,
    setWidth,
    setCollapsed,
    setIsDragging,
    clampWidth,
  };
};
