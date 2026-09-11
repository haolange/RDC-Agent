import { useEffect, useState } from 'react';

/**
 * Single ordered registry for every focus-trapping overlay layer (app modals,
 * task dialogs, confirmations). Only the topmost layer may consume Escape or
 * trap Tab, so nested dialogs close one level at a time.
 */
let nextLayerId = 1;
const stack: number[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

export function pushOverlayLayer(): number {
  const id = nextLayerId;
  nextLayerId += 1;
  stack.push(id);
  notify();
  return id;
}

export function popOverlayLayer(id: number): void {
  const index = stack.indexOf(id);
  if (index === -1) return;
  stack.splice(index, 1);
  notify();
}

export function isTopOverlayLayer(id: number | null): boolean {
  if (id === null) return stack.length === 0;
  return stack.length > 0 && stack[stack.length - 1] === id;
}

export function getOverlayLayerDepth(id: number | null): number {
  if (id === null) return 0;
  return stack.indexOf(id) + 1;
}

/**
 * Registers an overlay layer while `open` is true and reports whether it is
 * currently the topmost one.
 */
export function useOverlayLayer(open: boolean): { layerId: number | null; isTop: boolean } {
  const [layerId, setLayerId] = useState<number | null>(null);
  const [isTop, setIsTop] = useState(false);

  useEffect(() => {
    if (!open) {
      setLayerId(null);
      setIsTop(false);
      return undefined;
    }
    const id = pushOverlayLayer();
    setLayerId(id);
    const sync = () => setIsTop(isTopOverlayLayer(id));
    sync();
    listeners.add(sync);
    return () => {
      listeners.delete(sync);
      popOverlayLayer(id);
    };
  }, [open]);

  return { layerId, isTop };
}
