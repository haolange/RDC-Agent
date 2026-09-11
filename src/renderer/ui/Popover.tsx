import {
  cloneElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn';
import { useDynStyle } from '../lib/useDynStyle';
import { isTopOverlayLayer, useOverlayLayer } from '../lib/overlayStack';
import './Popover.css';

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 4;

export interface PopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactElement;
  children: ReactNode;
  align?: 'start' | 'end';
  side?: 'top' | 'bottom';
  className?: string;
  role?: 'dialog' | 'presentation';
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (!ref) return;
  if (typeof ref === 'function') {
    ref(value);
    return;
  }
  (ref as { current: T | null }).current = value;
}

export function Popover({
  open,
  onOpenChange,
  trigger,
  children,
  align = 'start',
  side = 'bottom',
  className,
  role = 'dialog',
}: PopoverProps) {
  const triggerRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  // An open popover is the topmost dismissible layer, so Escape closes only it
  // and leaves the modal it was launched from open.
  const { layerId } = useOverlayLayer(open);
  const [coords, setCoords] = useState({ left: VIEWPORT_MARGIN, top: VIEWPORT_MARGIN, ready: false });
  const positionStyle = useDynStyle({
    left: `${coords.left}px`,
    top: `${coords.top}px`,
  });

  const updatePosition = useCallback(() => {
    const triggerRect = triggerRef.current?.getBoundingClientRect();
    const content = contentRef.current;
    if (!triggerRect || !content) return;
    const width = content.offsetWidth;
    const height = content.offsetHeight;
    let left = align === 'end' ? triggerRect.right - width : triggerRect.left;
    let top = side === 'top' ? triggerRect.top - height - ANCHOR_GAP : triggerRect.bottom + ANCHOR_GAP;
    if (top + height > window.innerHeight - VIEWPORT_MARGIN) {
      top = triggerRect.top - height - ANCHOR_GAP;
    }
    if (top < VIEWPORT_MARGIN) {
      top = triggerRect.bottom + ANCHOR_GAP;
    }
    left = Math.min(Math.max(VIEWPORT_MARGIN, left), window.innerWidth - width - VIEWPORT_MARGIN);
    top = Math.min(Math.max(VIEWPORT_MARGIN, top), window.innerHeight - height - VIEWPORT_MARGIN);
    setCoords({ left, top, ready: true });
  }, [align, side]);

  useLayoutEffect(() => {
    if (!open) {
      setCoords((current) => (current.ready ? { ...current, ready: false } : current));
      return;
    }
    updatePosition();
  }, [open, children, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (contentRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      onOpenChange(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (!isTopOverlayLayer(layerId)) return;
      event.preventDefault();
      event.stopPropagation();
      onOpenChange(false);
      triggerRef.current?.focus();
    };
    const onReposition = () => updatePosition();
    window.addEventListener('pointerdown', onPointerDown);
    // Capture phase so the popover wins the key before any modal below it.
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open, layerId, onOpenChange, updatePosition]);

  const triggerNode = cloneElement(trigger, {
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node;
      assignRef((trigger as { ref?: Ref<HTMLElement> }).ref, node);
    },
    'aria-expanded': open,
    'aria-haspopup': trigger.props['aria-haspopup'] ?? 'dialog',
    onClick: (event: MouseEvent<HTMLElement>) => {
      trigger.props.onClick?.(event);
      onOpenChange(!open);
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      trigger.props.onKeyDown?.(event);
      if (event.key === 'Escape' && open) {
        event.preventDefault();
        onOpenChange(false);
        triggerRef.current?.focus();
      }
    },
  });

  return (
    <>
      {triggerNode}
      {open && typeof document !== 'undefined'
        ? createPortal(
          <div
            ref={contentRef}
            className={cn('ui-popover', className)}
            role={role}
            data-ready={coords.ready ? 'true' : 'false'}
            {...positionStyle}
          >
            {children}
          </div>,
          document.body,
        )
        : null}
    </>
  );
}
