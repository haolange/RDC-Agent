import type { PointerEvent as ReactPointerEvent } from 'react';
import './ResizeHandle.css';

export type ResizeHandleSide = 'left' | 'right';

export interface ResizeHandleProps {
  side: ResizeHandleSide;
  disabled?: boolean;
  onDragStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

export const isDockedResizeHandleVisible = (docked: boolean, collapsed: boolean): boolean => (
  docked && !collapsed
);

export function bindResizePointerDown(
  disabled: boolean,
  onDragStart: (event: ReactPointerEvent<HTMLDivElement>) => void,
) {
  return (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) {
      return;
    }
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Untrusted or unsupported pointers still proceed via window listeners.
    }
    onDragStart(event);
  };
}

export function ResizeHandle({ side, disabled = false, onDragStart }: ResizeHandleProps) {
  return (
    <div
      className={`panel-resize-handle panel-resize-handle-${side}${disabled ? ' disabled' : ''}`}
      data-testid={`panel-resize-handle-${side}`}
      aria-hidden="true"
      onPointerDown={bindResizePointerDown(disabled, onDragStart)}
    />
  );
}
