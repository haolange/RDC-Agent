import './ResizeHandle.css';

export interface ResizeHandleProps {
  side: 'left' | 'right';
  disabled?: boolean;
  onDragStart: (side: 'left' | 'right', baseWidth: number) => void;
}

export function ResizeHandle({ side, disabled = false, onDragStart }: ResizeHandleProps) {
  const handleClass = side === 'left'
    ? 'panel-resize-handle panel-resize-handle-left'
    : 'panel-resize-handle panel-resize-handle-right';

  return (
    <div
      className={`${handleClass} ${disabled ? 'disabled' : ''}`.trim()}
      onMouseDown={(event) => {
        if (disabled) return;
        event.preventDefault();
        const panel = (event.currentTarget as HTMLElement).previousElementSibling
          ?? (event.currentTarget as HTMLElement).nextElementSibling;
        const baseWidth = panel instanceof HTMLElement ? panel.getBoundingClientRect().width : 0;
        onDragStart(side, baseWidth);
      }}
    />
  );
}
