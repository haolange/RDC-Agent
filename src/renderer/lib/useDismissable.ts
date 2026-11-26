import { useEffect, useRef } from 'react';
import { isTopOverlayLayer } from './overlayStack';

export type DismissReason = 'outside' | 'escape';

export interface DismissableOptions {
  open: boolean;
  /**
   * The surface's layer from `useOverlayLayer`: only the topmost layer reacts, so nested surfaces close one level at
   * a time. A surface that is not on the overlay stack leaves it out.
   */
  layerId?: number | null;
  /** Nodes a press may land in without dismissing (the surface and its trigger). Without it only Escape dismisses. */
  inside?: () => readonly (Node | null | undefined)[];
  onDismiss: (reason: DismissReason) => void;
}

/** The one outside-press and Escape dismissal for popovers, menus and anchored panels. */
export function useDismissable({ open, layerId, inside, onDismiss }: DismissableOptions): void {
  const latest = useRef({ layerId, inside, onDismiss });
  latest.current = { layerId, inside, onDismiss };

  useEffect(() => {
    if (!open) return undefined;
    const isTop = () => latest.current.layerId === undefined || isTopOverlayLayer(latest.current.layerId);
    const onPointerDown = (event: PointerEvent) => {
      const { inside: insideNodes, onDismiss: dismiss } = latest.current;
      if (!insideNodes || !isTop()) return;
      const target = event.target as Node;
      if (insideNodes().some((node) => node?.contains(target))) return;
      dismiss('outside');
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !isTop()) return;
      event.preventDefault();
      event.stopPropagation();
      latest.current.onDismiss('escape');
    };
    window.addEventListener('pointerdown', onPointerDown);
    // Capture phase, so the topmost surface wins the key before any modal below it.
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);
}
