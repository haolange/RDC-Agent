import { useEffect, useRef, useState, type RefObject } from 'react';
import { prefersReducedMotion } from '../lib/motion';

export type PresenceState = 'open' | 'closing';

/** Longest exit any overlay plays; a safety net for an element that never reports animationend. */
const EXIT_FALLBACK_MS = 400;

/**
 * Keeps an overlay mounted while its exit animation plays. The element behind `ref` carries `data-state="closing"`
 * during the exit; it unmounts on that element's own animationend, at once when it has no exit animation or
 * under reduced motion, or after the fallback. `onExited` runs once the element has left, so an owner can drop
 * the content it kept alive for the exit.
 */
export function usePresence(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  onExited?: () => void,
): { mounted: boolean; state: PresenceState } {
  const [mounted, setMounted] = useState(open);
  const exited = useRef(onExited);
  exited.current = onExited;
  const wasMounted = useRef(mounted);

  useEffect(() => {
    if (wasMounted.current && !mounted) exited.current?.();
    wasMounted.current = mounted;
  }, [mounted]);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return undefined;
    }
    if (!mounted) return undefined;
    const element = ref.current;
    const reducedMotion = prefersReducedMotion();
    // An element without an exit animation (or under reduced motion) leaves at once.
    const exitAnimation = element ? getComputedStyle(element).animationName : '';
    if (!element || reducedMotion || !exitAnimation || exitAnimation === 'none') {
      setMounted(false);
      return undefined;
    }
    const finish = (event?: AnimationEvent) => {
      if (event && event.target !== element) return;
      setMounted(false);
    };
    element.addEventListener('animationend', finish);
    const fallback = window.setTimeout(finish, EXIT_FALLBACK_MS);
    return () => {
      element.removeEventListener('animationend', finish);
      window.clearTimeout(fallback);
    };
  }, [open, mounted, ref]);

  return { mounted: open || mounted, state: open ? 'open' : 'closing' };
}
