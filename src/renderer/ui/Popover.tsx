import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
import { createPortal, flushSync } from 'react-dom';
import { cn } from '../lib/cn';
import { placeAnchoredSurface } from '../lib/anchoredSurface';
import { useDynStyle } from '../lib/useDynStyle';
import { isTopOverlayLayer, useOverlayLayer } from '../lib/overlayStack';
import { useDismissable } from '../lib/useDismissable';
import { getModalFocusableElements } from '../lib/useModalFocus';
import { usePresence } from './usePresence';
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
  /**
   * `dialog` (the default) is a non-modal dialog: focus moves in when it opens, Tab from the trigger enters it and Tab
   * past its last control continues after the trigger. `presentation` wraps content that owns its own role and focus
   * (Menu).
   */
  role?: 'dialog' | 'presentation';
  /** Accessible name of the dialog; without it the dialog is named by its trigger. */
  label?: string;
  dismissOnTab?: boolean;
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
  label,
  dismissOnTab = false,
}: PopoverProps) {
  const triggerRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const generatedId = useId();
  const contentId = `${generatedId}-popover`;
  const triggerId = (trigger.props.id as string | undefined) ?? `${generatedId}-trigger`;
  const isDialog = role === 'dialog';
  const focusedOpen = useRef(false);
  // An open popover is the topmost dismissible layer, so Escape closes only it
  // and leaves the modal it was launched from open.
  const { layerId } = useOverlayLayer(open, 'layout');
  const presence = usePresence(open, contentRef);
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
    const { left, top } = placeAnchoredSurface(triggerRect, { width, height },
      { width: window.innerWidth, height: window.innerHeight }, align, side, VIEWPORT_MARGIN, ANCHOR_GAP);
    setCoords({ left, top, ready: true });
  }, [align, side]);

  // A closing popover keeps its place while the exit plays; it is measured afresh after it unmounts.
  useLayoutEffect(() => {
    if (!open && contentRef.current?.contains(document.activeElement)) triggerRef.current?.focus();
    if (!presence.mounted) {
      setCoords((current) => (current.ready ? { ...current, ready: false } : current));
      return;
    }
    if (open) updatePosition();
  }, [open, presence.mounted, children, updatePosition]);

  // Focus enters a dialog once it is placed and visible; a Menu moves focus to its active item itself.
  useEffect(() => {
    if (!open) {
      focusedOpen.current = false;
      return;
    }
    if (!isDialog || !coords.ready || focusedOpen.current) return;
    focusedOpen.current = true;
    const content = contentRef.current;
    if (content && !content.contains(document.activeElement)) (getModalFocusableElements(content)[0] ?? content).focus();
  }, [coords.ready, isDialog, open]);

  useDismissable({
    open,
    layerId,
    inside: () => [contentRef.current, triggerRef.current],
    onDismiss: (reason) => {
      onOpenChange(false);
      if (reason === 'escape') triggerRef.current?.focus();
    },
  });

  useEffect(() => {
    if (!open) return;
    const onReposition = () => updatePosition();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onReposition);
    if (contentRef.current) observer?.observe(contentRef.current);
    if (triggerRef.current) observer?.observe(triggerRef.current);
    document.fonts?.addEventListener('loadingdone', onReposition);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      observer?.disconnect();
      document.fonts?.removeEventListener('loadingdone', onReposition);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open, updatePosition]);

  const triggerNode = cloneElement(trigger, {
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node;
      assignRef((trigger as { ref?: Ref<HTMLElement> }).ref, node);
    },
    id: triggerId,
    'aria-expanded': open,
    'aria-controls': isDialog && presence.mounted ? contentId : undefined,
    'aria-haspopup': trigger.props['aria-haspopup'] ?? 'dialog',
    onClick: (event: MouseEvent<HTMLElement>) => {
      trigger.props.onClick?.(event);
      if (event.defaultPrevented) return;
      onOpenChange(!open);
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      trigger.props.onKeyDown?.(event);
      if (!open || !isTopOverlayLayer(layerId)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onOpenChange(false);
        triggerRef.current?.focus();
      } else if (event.key === 'Tab' && !event.shiftKey && isDialog && contentRef.current) {
        // The surface is portaled to the end of the document; Tab from its trigger enters it.
        event.preventDefault();
        (getModalFocusableElements(contentRef.current)[0] ?? contentRef.current).focus();
      }
    },
  });

  // The trigger's own name is the dialog's name unless a label is given; a trigger named by another element lends
  // that element (a swatch named by its field label).
  const triggerLabelledBy = trigger.props['aria-labelledby'] as string | undefined;
  const nameProps = !isDialog ? {} : label ? { 'aria-label': label } : { 'aria-labelledby': triggerLabelledBy ?? triggerId };

  /** Tab past either end of a dialog leaves through its trigger, as if the surface sat right after it. */
  const leaveByTab = (event: KeyboardEvent<HTMLDivElement>) => {
    const content = event.currentTarget;
    const focusable = getModalFocusableElements(content);
    const active = document.activeElement;
    if (event.shiftKey) {
      if (focusable.length > 0 && active !== focusable[0] && active !== content) return;
      event.preventDefault();
      triggerRef.current?.focus();
      return;
    }
    if (focusable.length > 0 && active !== focusable[focusable.length - 1]) return;
    // Closing first lets the native Tab continue from the trigger to whatever follows it.
    flushSync(() => onOpenChange(false));
    triggerRef.current?.focus();
  };

  return (
    <>
      {triggerNode}
      {presence.mounted && typeof document !== 'undefined'
        ? createPortal(
          <div
            ref={contentRef}
            id={contentId}
            className={cn('ui-popover', className)}
            role={role}
            tabIndex={isDialog ? -1 : undefined}
            {...nameProps}
            onKeyDownCapture={(event) => {
              if (!open || !isTopOverlayLayer(layerId) || !event.currentTarget.contains(event.target as Node)) return;
              if (event.key === 'Tab' && isDialog && !dismissOnTab) {
                leaveByTab(event);
                return;
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
              } else if (event.key !== 'Tab' || !dismissOnTab) return;
              // Release this surface before its dialog handles the key. Tab continues natively from the trigger.
              flushSync(() => onOpenChange(false));
              triggerRef.current?.focus();
            }}
            data-side={side}
            data-state={presence.state}
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
