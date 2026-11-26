import { useEffect, useRef, type RefObject } from 'react';
import { isTopOverlayLayer } from './overlayStack';

export const MODAL_FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function getModalFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE_SELECTOR)).filter(
    (element) =>
      !element.hasAttribute('disabled') &&
      element.getAttribute('aria-hidden') !== 'true' &&
      element.getClientRects().length > 0,
  );
}

export function shouldCaptureEscapedFocus(trap: boolean): boolean {
  return trap;
}

function restoreDialogFocus(previous: HTMLElement | null, fallback?: RefObject<HTMLElement>) {
  // An editor can replace its empty-state action with a toolbar action in the closing render.
  const target = previous?.isConnected ? previous : fallback?.current;
  target?.focus();
}

export function useModalFocus(options: {
  open: boolean;
  containerRef: RefObject<HTMLElement>;
  onClose: () => void;
  busy?: boolean;
  trap?: boolean;
  /** Focus target after an edit removes the action that opened the dialog. */
  fallbackFocusRef?: RefObject<HTMLElement>;
  /**
   * Layer id from `useOverlayLayer`. When provided, Escape and Tab are only
   * handled while this layer is the topmost overlay.
   */
  layerId?: number | null;
}): void {
  const { open, containerRef, onClose, busy = false, trap = true, fallbackFocusRef, layerId = null } = options;
  // Escape reads the latest close handler and busy state; owners pass a fresh onClose on every render, and re-arming
  // the trap with each one made where focus landed depend on how many renders a frame saw.
  const latest = useRef({ onClose, busy });
  /** Focus has been inside the dialog; until then the opening capture owns where it lands. */
  const focusEntered = useRef(false);
  latest.current = { onClose, busy };

  useEffect(() => {
    if (!open) return undefined;
    focusEntered.current = false;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frameId = window.requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) return;
      // Preserve an explicit autofocus target chosen by the dialog (for example,
      // Keep editing / Cancel), rather than replacing it with the first action.
      if (container.contains(document.activeElement)) return;
      const first = getModalFocusableElements(container)[0];
      (first ?? container).focus();
    });
    return () => {
      window.cancelAnimationFrame(frameId);
      restoreDialogFocus(previouslyFocused, fallbackFocusRef);
    };
  }, [containerRef, fallbackFocusRef, open]);

  useEffect(() => {
    if (!open) return undefined;
    const focusTrapRoot = () => {
      const root = containerRef.current;
      if (!root) return;
      if (root.contains(document.activeElement)) return;
      const first = getModalFocusableElements(root)[0];
      (first ?? root).focus();
    };
    const frameId = window.requestAnimationFrame(() => {
      if (!shouldCaptureEscapedFocus(trap) || !isTopOverlayLayer(layerId)) return;
      focusTrapRoot();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      const root = containerRef.current;
      if (!root) return;
      // An Escape another layer already consumed must not close this one as well: listener order on the
      // document follows effect order, and the closed layer can unmount before later listeners run.
      if (event.key === 'Escape' && event.defaultPrevented) return;
      if (!isTopOverlayLayer(layerId)) return;
      if (event.key === 'Escape') {
        if (latest.current.busy) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        latest.current.onClose();
        return;
      }
      if (event.key !== 'Tab' || !trap) return;
      const focusable = getModalFocusableElements(root);
      if (focusable.length === 0) {
        event.preventDefault();
        root.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !root.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !root.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    const handleFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && containerRef.current?.contains(event.target)) focusEntered.current = true;
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('focusin', handleFocusIn);
    return () => {
      window.cancelAnimationFrame(frameId);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('focusin', handleFocusIn);
    };
  }, [containerRef, layerId, open, trap]);

  // Entering or leaving a busy state disables controls, which drops focus from a disabled one to the page; the
  // dialog takes it back in the same commit, so the result never depends on frame timing.
  const settledBusy = useRef(busy);
  useEffect(() => {
    if (settledBusy.current === busy) return;
    settledBusy.current = busy;
    if (!open || !focusEntered.current || !shouldCaptureEscapedFocus(trap) || !isTopOverlayLayer(layerId)) return;
    const root = containerRef.current;
    const active = document.activeElement;
    // Chromium moves focus off a control that becomes disabled; a focused disabled control counts as lost either way.
    if (root && (!root.contains(active) || active?.matches(':disabled'))) root.focus();
  }, [busy, containerRef, layerId, open, trap]);
}
