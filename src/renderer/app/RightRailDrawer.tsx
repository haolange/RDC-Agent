import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Button } from '../ui/Button';

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const getFocusableElements = (container: HTMLElement): HTMLElement[] => (
  Array.from(container.querySelectorAll<HTMLElement>(focusableSelector))
    .filter((element) => !element.hasAttribute('disabled') && element.getClientRects().length > 0)
);

interface RightRailDrawerProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function RightRailDrawer({ open, onClose, children }: RightRailDrawerProps) {
  const drawerRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const drawer = drawerRef.current;
    const frameId = window.requestAnimationFrame(() => {
      const first = drawer ? getFocusableElements(drawer)[0] : null;
      (first ?? drawer)?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !drawer) return;
      const focusable = getFocusableElements(drawer);
      if (focusable.length === 0) {
        event.preventDefault();
        drawer.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frameId);
      document.removeEventListener('keydown', handleKeyDown);
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
    };
  }, [onClose, open]);

  if (!open) return null;
  return (
    <div className="right-rail-drawer" data-testid="right-rail-drawer">
      <div className="right-rail-drawer-backdrop" aria-hidden="true" onMouseDown={onClose} />
      <aside
        ref={drawerRef}
        className="right-rail-drawer-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Session inspector"
        tabIndex={-1}
      >
        <header className="right-rail-drawer-header">
          <span>Session inspector</span>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close session inspector">Close</Button>
        </header>
        <div className="right-rail-drawer-content scrollbar-thin">{children}</div>
      </aside>
    </div>
  );
}