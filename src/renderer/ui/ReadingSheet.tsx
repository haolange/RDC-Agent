import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn';
import { useOverlayLayer } from '../lib/overlayStack';
import { useModalFocus } from '../lib/useModalFocus';
import { useReadingPanelGeometry } from '../lib/useReadingPanelGeometry';
import { useReadingSheetHeight } from '../lib/useReadingSheetHeight';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import { usePresence } from './usePresence';
import './ReadingSheet.css';

export interface ReadingSheetProps {
  open: boolean;
  title: ReactNode;
  meta?: ReactNode;
  /** Header actions placed before the close button. */
  actions?: ReactNode;
  /** Notices and errors that must stay visible above the scrolling body. */
  status?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  /** Runs once the exit animation has finished, so the owner can drop the content it kept for the exit. */
  onExited?: () => void;
  closeLabel: string;
  className?: string;
  dataTestId?: string;
  /** Follow intrinsic content size with a bottom-anchored transition in the workbench. */
  animateHeight?: boolean;
}

/**
 * The one reading surface over the transcript: it occupies the area above the Composer, grows with its content
 * up to that area, and keeps header and status fixed while the body is the only scroller.
 */
export function ReadingSheet({
  open, title, meta, actions, status, children, onClose, onExited, closeLabel, className,
  dataTestId, animateHeight = false,
}: ReadingSheetProps) {
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const geometry = useReadingPanelGeometry();
  const shown = open && (geometry.ready || !geometry.anchored);
  const { layerId } = useOverlayLayer(shown, 'layout');
  const presence = usePresence(shown, sheetRef, onExited);
  useModalFocus({ open: shown, containerRef: sheetRef, onClose, layerId });
  const contentRef = useRef<HTMLDivElement>(null);
  const animated = presence.mounted && geometry.ready && animateHeight;
  useReadingSheetHeight(animated, sheetRef, contentRef, Boolean(status));

  if (typeof document === 'undefined' || !presence.mounted) return null;

  return createPortal(
    <div
      className={cn('ui-reading-sheet-overlay', !geometry.anchored && 'is-viewport')}
      {...geometry.style}
      data-state={presence.state}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={sheetRef}
        className={cn('ui-reading-sheet', animated && 'is-height-animated', className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy="false"
        tabIndex={-1}
        data-testid={dataTestId}
      >
        <header className="ui-reading-sheet-header">
          <div className="ui-reading-sheet-heading">
            <h2 id={titleId} className="ui-reading-sheet-title">{title}</h2>
            {meta ? <div className="ui-reading-sheet-meta">{meta}</div> : null}
          </div>
          <div className="ui-reading-sheet-actions">
            {actions}
            <IconButton label={closeLabel} size="sm" onClick={onClose}>
              <Icon name="close" size={16} />
            </IconButton>
          </div>
        </header>
        {status ? <div className="ui-reading-sheet-status">{status}</div> : null}
        <div className="ui-reading-sheet-body">
          {animated ? <div className="ui-reading-sheet-content" ref={contentRef}>{children}</div> : children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
