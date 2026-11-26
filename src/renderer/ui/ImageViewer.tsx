import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useDynStyle } from '../lib/useDynStyle';
import { useModalFocus } from '../lib/useModalFocus';
import { useOverlayLayer } from '../lib/overlayStack';
import { useUiLabels } from '../lib/useUiLabels';
import { Icon } from './Icon';
import { Chevron } from './Chevron';
import { IconButton } from './IconButton';
import { usePresence } from './usePresence';
import './ImageViewer.css';

export interface ImageViewerItem {
  src?: string;
  /** Human caption, e.g.「修复前后的头发对照」; never a raw file id. */
  title: string;
}

export interface ImageViewerProps {
  open: boolean;
  items: readonly ImageViewerItem[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  onExited?: () => void;
  actions?: ReactNode;
  status?: ReactNode;
  onImageError?: () => void;
  /** Opens the full-resolution source outside the app when the owner has one. */
  onOpenOriginal?: (index: number) => void;
}

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const ZOOM_STEP = 1.25;

const clampScale = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

/** The one image viewer: zoom (buttons, wheel, double click), pan by dragging, previous / next, open original. */
export function ImageViewer({
  open,
  items,
  index,
  onIndexChange,
  onClose,
  onExited,
  actions,
  status,
  onImageError,
  onOpenOriginal,
}: ImageViewerProps) {
  const labels = useUiLabels().imageViewer;
  const overlayRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const { layerId } = useOverlayLayer(open, 'layout');
  const presence = usePresence(open, overlayRef, onExited);
  useModalFocus({ open, containerRef: stageRef, onClose, busy: false, layerId });
  const transform = useDynStyle({ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` });
  const count = items.length;
  const item = items[Math.min(index, count - 1)];
  const hasImage = Boolean(item?.src);

  const reset = useCallback(() => setView({ scale: 1, x: 0, y: 0 }), []);
  useEffect(reset, [index, open, reset]);

  const step = useCallback(
    (delta: number) => {
      if (count > 1) onIndexChange((index + delta + count) % count);
    },
    [count, index, onIndexChange],
  );

  const zoom = useCallback((factor: number) => {
    setView((current) => {
      const scale = clampScale(current.scale * factor);
      return scale === MIN_SCALE ? { scale, x: 0, y: 0 } : { ...current, scale };
    });
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') step(-1);
      else if (event.key === 'ArrowRight') step(1);
      else if (hasImage && (event.key === '+' || event.key === '=')) zoom(ZOOM_STEP);
      else if (hasImage && event.key === '-') zoom(1 / ZOOM_STEP);
      else if (hasImage && event.key === '0') reset();
      else return;
      event.preventDefault();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, step, zoom, reset, hasImage]);

  const onWheel = (event: WheelEvent) => zoom(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
  const onPointerDown = (event: ReactPointerEvent<HTMLImageElement>) => {
    if (view.scale === MIN_SCALE) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, offsetX: view.x, offsetY: view.y };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLImageElement>) => {
    const start = drag.current;
    if (!start) return;
    setView((current) => ({
      ...current,
      x: start.offsetX + event.clientX - start.x,
      y: start.offsetY + event.clientY - start.y,
    }));
  };

  if (!presence.mounted || !item || typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={overlayRef}
      className="ui-image-viewer"
      data-state={presence.state}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={stageRef}
        className="ui-image-viewer-stage"
        role="dialog"
        aria-modal="true"
        aria-label={item.title}
        tabIndex={-1}
      >
        <header className="ui-image-viewer-bar">
          <span className="ui-image-viewer-title">{item.title}</span>
          {count > 1 ? <span className="ui-image-viewer-position">{labels.position(index + 1, count)}</span> : null}
          <div className="ui-image-viewer-actions">
            <IconButton
              label={labels.zoomOut}
              data-tooltip={labels.zoomOut}
              size="sm"
              disabled={!hasImage || view.scale <= MIN_SCALE}
              onClick={() => zoom(1 / ZOOM_STEP)}
            >
              <Icon name="minus" />
            </IconButton>
            <IconButton
              label={labels.reset}
              data-tooltip={labels.reset}
              size="sm"
              disabled={!hasImage || view.scale === MIN_SCALE}
              onClick={reset}
            >
              <Icon name="refresh" />
            </IconButton>
            <IconButton
              label={labels.zoomIn}
              data-tooltip={labels.zoomIn}
              size="sm"
              disabled={!hasImage || view.scale >= MAX_SCALE}
              onClick={() => zoom(ZOOM_STEP)}
            >
              <Icon name="plus" />
            </IconButton>
            {onOpenOriginal ? (
              <IconButton
                label={labels.openOriginal}
                data-tooltip={labels.openOriginal}
                size="sm"
                onClick={() => onOpenOriginal(index)}
              >
                <Icon name="external" />
              </IconButton>
            ) : null}
            {actions}
            <IconButton label={labels.close} data-tooltip={labels.close} size="sm" onClick={onClose}>
              <Icon name="close" />
            </IconButton>
          </div>
        </header>
        {status ? <div className="ui-image-viewer-status">{status}</div> : null}
        <div className="ui-image-viewer-canvas" onWheel={hasImage ? onWheel : undefined}>
          {item.src ? (
            <img
              className={`ui-image-viewer-image${view.scale > MIN_SCALE ? ' is-zoomed' : ''}`}
              src={item.src}
              alt={item.title}
              draggable={false}
              onDoubleClick={() => (view.scale === MIN_SCALE ? zoom(2) : reset())}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={() => {
                drag.current = null;
              }}
              onPointerCancel={() => {
                drag.current = null;
              }}
              onError={onImageError}
              {...transform}
            />
          ) : null}
          {count > 1 ? (
            <>
              <IconButton
                label={labels.previous}
                data-tooltip={labels.previous}
                className="ui-image-viewer-step is-previous"
                onClick={() => step(-1)}
              >
                <Chevron direction="left" size={18} />
              </IconButton>
              <IconButton
                label={labels.next}
                data-tooltip={labels.next}
                className="ui-image-viewer-step is-next"
                onClick={() => step(1)}
              >
                <Chevron size={18} />
              </IconButton>
            </>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
