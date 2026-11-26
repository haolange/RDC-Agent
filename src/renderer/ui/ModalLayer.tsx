import { useRef, type HTMLAttributes, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { isTopOverlayLayer, useOverlayLayer } from '../lib/overlayStack';
import { useModalFocus } from '../lib/useModalFocus';
import { usePresence } from './usePresence';

export interface ModalLayerProps extends Omit<HTMLAttributes<HTMLDivElement>, 'role' | 'className' | 'children'> {
  open: boolean;
  /** Escape, while this is the topmost layer and not busy. */
  onClose: () => void;
  /** A press on the overlay outside the dialog; defaults to `onClose`. */
  onDismiss?: () => void;
  /** Whether that press counts on mousedown (the default) or on click. */
  dismissOn?: 'mousedown' | 'click';
  busy?: boolean;
  overlayClassName: string;
  overlayTestId?: string;
  className: string;
  role?: 'dialog' | 'alertdialog';
  layerTiming?: 'layout' | 'effect';
  fallbackFocusRef?: RefObject<HTMLElement>;
  dialogRef?: RefObject<HTMLDivElement>;
  /** Rendered in the same portal after the overlay, so sub-dialogs stack above it without bubbling into it. */
  after?: ReactNode;
  children: ReactNode;
}

/**
 * The modal layer every full dialog stands on: a portal with an overlay that plays its enter and exit, one overlay
 * layer so Escape and the Tab trap belong to the topmost layer only, focus moved in on open and returned on close,
 * and dismissal by a press on the overlay itself. The dialog's own layout is its owner's.
 */
export function ModalLayer({
  open,
  onClose,
  onDismiss = onClose,
  dismissOn = 'mousedown',
  busy = false,
  overlayClassName,
  overlayTestId,
  className,
  role = 'dialog',
  layerTiming = 'effect',
  fallbackFocusRef,
  dialogRef,
  after,
  children,
  ...dialogProps
}: ModalLayerProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const ownDialogRef = useRef<HTMLDivElement>(null);
  const containerRef = dialogRef ?? ownDialogRef;
  const presence = usePresence(open, overlayRef);
  const { layerId } = useOverlayLayer(open, layerTiming);
  useModalFocus({ open, containerRef, onClose, busy, layerId, fallbackFocusRef });

  if (!presence.mounted || typeof document === 'undefined') return null;

  const dismiss = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && !busy && isTopOverlayLayer(layerId)) onDismiss();
  };
  return createPortal(
    <>
      <div
        ref={overlayRef}
        className={overlayClassName}
        data-state={presence.state}
        data-testid={overlayTestId}
        onMouseDown={dismissOn === 'mousedown' ? dismiss : undefined}
        onClick={dismissOn === 'click' ? dismiss : undefined}
      >
        <div ref={containerRef} className={className} role={role} tabIndex={-1} aria-modal="true" {...dialogProps}>
          {children}
        </div>
      </div>
      {after}
    </>,
    document.body,
  );
}
