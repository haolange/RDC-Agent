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

interface WorkbenchPanelDrawerProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  side?: 'left' | 'right';
  title: string;
  closeLabel: string;
  keepMounted?: boolean;
  'data-testid': string;
}

export function WorkbenchPanelDrawer({ open, onClose, children, side = 'right', title, closeLabel, keepMounted = false, 'data-testid': testId }: WorkbenchPanelDrawerProps) {
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
      const activeDialog = event.target instanceof Element ? event.target.closest('[role="dialog"]') : null;
      if (activeDialog && activeDialog !== drawer) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
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

  if (!open && !keepMounted) return null;
  return (
    <div hidden={!open} className={`right-rail-drawer ${side === 'left' ? 'left-navigation-drawer' : ''}`} data-testid={testId}>
      <div className="right-rail-drawer-backdrop" aria-hidden="true" onMouseDown={onClose} />
      <aside
        ref={drawerRef}
        className="right-rail-drawer-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <header className="right-rail-drawer-header">
          <span>{title}</span>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label={closeLabel}>{closeLabel}</Button>
        </header>
        <div className="right-rail-drawer-content scrollbar-thin">{children}</div>
      </aside>
    </div>
  );
}
