import { useEffect } from 'react';
import './Proximity.css';

const ACTIVE_ATTRIBUTE = 'data-proximity-active';

/**
 * One document listener serves every `[data-proximity]` surface. Pointer moves are merged into one write per frame;
 * the hovered surface receives its local pointer position as --proximity-x / --proximity-y through the CSSOM (the CSP
 * forbids style attributes, not CSSOM writes) and `data-proximity-active` while the pointer is over it. Touch and pen
 * input never light it, and the styles switch it off for keyboard-only use and reduced motion.
 */
export function ProximityHost() {
  useEffect(() => {
    let active: HTMLElement | null = null;
    let frame = 0;
    let pending: PointerEvent | null = null;

    const release = () => {
      active?.removeAttribute(ACTIVE_ATTRIBUTE);
      active = null;
    };

    const apply = () => {
      frame = 0;
      const event = pending;
      pending = null;
      if (!event) return;
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-proximity]') : null;
      if (target !== active) {
        release();
        active = target;
        active?.setAttribute(ACTIVE_ATTRIBUTE, '');
      }
      if (!active) return;
      const rect = active.getBoundingClientRect();
      active.style.setProperty('--proximity-x', `${event.clientX - rect.left}px`);
      active.style.setProperty('--proximity-y', `${event.clientY - rect.top}px`);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      pending = event;
      if (!frame) frame = window.requestAnimationFrame(apply);
    };
    const onPointerLeave = () => release();

    document.addEventListener('pointermove', onPointerMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onPointerLeave);
    window.addEventListener('blur', onPointerLeave);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      release();
      document.removeEventListener('pointermove', onPointerMove);
      document.documentElement.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('blur', onPointerLeave);
    };
  }, []);
  return null;
}

/** The glow layer a proximity surface renders as its first child: a soft fill around the pointer and a lit rim segment. */
export function ProximityGlow() {
  return <span className="ui-proximity-glow" aria-hidden="true" />;
}
