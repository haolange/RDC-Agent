import { useRef } from 'react';
import { useOverlayLayer } from '../lib/overlayStack';
import { useModalFocus } from '../lib/useModalFocus';
import { Button } from '../ui/Button';
import type { ReactNode } from 'react';

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

export function WorkbenchPanelDrawer({
  open,
  onClose,
  children,
  side = 'right',
  title,
  closeLabel,
  keepMounted = false,
  'data-testid': testId,
}: WorkbenchPanelDrawerProps) {
  const drawerRef = useRef<HTMLElement>(null);
  // A modal layer like every other: Escape and the Tab trap belong to the topmost layer, so a dialog or menu opened
  // from inside the drawer handles its own keys first, and closing returns focus to whatever opened the drawer.
  const { layerId } = useOverlayLayer(open, 'layout');
  useModalFocus({ open, containerRef: drawerRef, onClose, layerId });

  if (!open && !keepMounted) return null;
  return (
    <div
      hidden={!open}
      className={`right-rail-drawer ${side === 'left' ? 'left-navigation-drawer' : ''}`}
      data-testid={testId}
    >
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
          <Button variant="ghost" size="sm" onClick={onClose} aria-label={closeLabel}>
            {closeLabel}
          </Button>
        </header>
        <div className="right-rail-drawer-content scrollbar-thin">{children}</div>
      </aside>
    </div>
  );
}
