import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn';
import { useOverlayLayer } from '../lib/overlayStack';
import { useModalFocus } from '../lib/useModalFocus';
import { useReadingPanelGeometry } from '../lib/useReadingPanelGeometry';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import './ReadingSheet.css';

export interface ReadingSheetProps {
  title: ReactNode;
  /** Plain-text name for the dialog when `title` is not a string. */
  label?: string;
  meta?: ReactNode;
  /** Header actions placed before the close button. */
  actions?: ReactNode;
  /** Notices and errors that must stay visible above the scrolling body. */
  status?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  closeLabel: string;
  busy?: boolean;
  className?: string;
  dataTestId?: string;
}

/**
 * The one reading surface over the transcript: it occupies the area above the Composer, grows with its content
 * up to that area, and keeps header, status and footer fixed while the body is the only scroller.
 */
export function ReadingSheet({
  title, label, meta, actions, status, footer, children, onClose, closeLabel, busy = false, className, dataTestId,
}: ReadingSheetProps) {
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const geometry = useReadingPanelGeometry();
  const visible = geometry.ready || !geometry.anchored;
  const { layerId } = useOverlayLayer(visible);
  useModalFocus({ open: visible, containerRef: sheetRef, onClose, busy, layerId });

  if (typeof document === 'undefined' || !visible) return null;

  return createPortal(
    <div
      className={cn('ui-reading-sheet-overlay', !geometry.anchored && 'is-viewport')}
      {...geometry.style}
      data-overlay-layer
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={sheetRef}
        className={cn('ui-reading-sheet', className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={label ? undefined : titleId}
        aria-label={label}
        aria-busy={busy}
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
            <IconButton label={closeLabel} size="sm" disabled={busy} onClick={onClose}>
              <Icon name="close" size={16} />
            </IconButton>
          </div>
        </header>
        {status ? <div className="ui-reading-sheet-status">{status}</div> : null}
        <div className="ui-reading-sheet-body">{children}</div>
        {footer ? <footer className="ui-reading-sheet-footer">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}
