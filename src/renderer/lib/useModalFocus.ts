import { useEffect, type RefObject } from 'react';
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
  return Array.from(container.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE_SELECTOR))
    .filter((element) => (
      !element.hasAttribute('disabled')
      && element.getAttribute('aria-hidden') !== 'true'
      && element.getClientRects().length > 0
    ));
}

export function resolveModalTrapRoot(
  container: HTMLElement,
  trapRoot: HTMLElement | null | undefined,
): HTMLElement {
  return trapRoot && container.contains(trapRoot) ? trapRoot : container;
}

export function shouldCaptureEscapedFocus(trap: boolean): boolean {
  return trap;
}

export function useModalFocus(options: {
  open: boolean;
  containerRef: RefObject<HTMLElement>;
  onClose: () => void;
  busy?: boolean;
  trap?: boolean;
  trapRootRef?: RefObject<HTMLElement>;
  /**
   * Layer id from `useOverlayLayer`. When provided, Escape and Tab are only
   * handled while this layer is the topmost overlay.
   */
  layerId?: number | null;
}): void {
  const { open, containerRef, onClose, busy = false, trap = true, trapRootRef, layerId = null } = options;

  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
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
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [containerRef, open]);

  useEffect(() => {
    if (!open) return undefined;
    const focusTrapRoot = () => {
      const container = containerRef.current;
      if (!container) return;
      const root = resolveModalTrapRoot(container, trapRootRef?.current);
      if (root.contains(document.activeElement)) return;
      const first = getModalFocusableElements(root)[0];
      (first ?? root).focus();
    };
    const frameId = window.requestAnimationFrame(() => {
      if (!shouldCaptureEscapedFocus(trap) || !isTopOverlayLayer(layerId)) return;
      focusTrapRoot();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      const container = containerRef.current;
      if (!container) return;
      if (!isTopOverlayLayer(layerId)) return;
      if (event.key === 'Escape') {
        if (busy) return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !trap) return;
      const root = resolveModalTrapRoot(container, trapRootRef?.current);
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
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frameId);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [busy, containerRef, layerId, onClose, open, trap, trapRootRef]);
}
