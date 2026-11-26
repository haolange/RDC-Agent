import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDynStyle } from '../lib/useDynStyle';
import { usePresence } from './usePresence';
import './Tooltip.css';

/** Hover waits this long before the first tooltip; once one has shown, the next appears at once. */
const HOVER_DELAY_MS = 450;
const WARM_WINDOW_MS = 300;
const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 6;

interface ActiveTooltip {
  /** The element the bubble points at. */
  target: HTMLElement;
  /** The element described while the bubble shows: the focused control, which may contain the target. */
  owner: HTMLElement;
  text: string;
}

const tooltipTarget = (node: EventTarget | null): HTMLElement | null =>
  node instanceof Element ? node.closest<HTMLElement>('[data-tooltip]') : null;

const normalized = (text: string) => text.replace(/\s+/gu, ' ').trim();

/**
 * A tooltip that repeats text already fully visible adds nothing: it shows only when it says something more, or
 * when the visible text is cut off and the tooltip is the way to read all of it.
 */
const repeatsVisibleText = (target: HTMLElement, text: string): boolean => {
  if (normalized(target.textContent) !== normalized(text)) return false;
  return ![target, ...target.querySelectorAll<HTMLElement>('*')].some(
    (element) => element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1,
  );
};

/** The accessible name a tooltip would repeat; describing an element with its own name adds nothing. */
const accessibleName = (element: HTMLElement) => (element.getAttribute('aria-label') ?? element.textContent).trim();

/**
 * The one tooltip surface. Any element with `data-tooltip` gets it on pointer hover (after a short delay) or keyboard
 * focus; Escape, pointer press and leaving dismiss it. While visible, an element whose name differs from the text is
 * described by the tooltip so screen readers hear what sighted users see.
 */
export function TooltipHost() {
  const id = useId();
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<ActiveTooltip | null>(null);
  const [shown, setShown] = useState<ActiveTooltip | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, ready: false });
  const timer = useRef<number | undefined>(undefined);
  const lastHiddenAt = useRef(0);
  const presence = usePresence(active !== null, bubbleRef);
  const positionStyle = useDynStyle({ left: `${position.left}px`, top: `${position.top}px` });

  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    setActive((current) => {
      if (current) lastHiddenAt.current = Date.now();
      return null;
    });
  }, []);

  const show = useCallback((target: HTMLElement, immediate: boolean, owner: HTMLElement = target) => {
    const text = target.dataset.tooltip?.trim();
    window.clearTimeout(timer.current);
    if (!text || repeatsVisibleText(target, text)) return;
    const warm = Date.now() - lastHiddenAt.current < WARM_WINDOW_MS;
    if (immediate || warm) {
      setActive({ target, owner, text });
      return;
    }
    timer.current = window.setTimeout(() => setActive({ target, owner, text }), HOVER_DELAY_MS);
  }, []);

  useEffect(() => {
    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const target = tooltipTarget(event.target);
      if (target) show(target, false);
    };
    const onPointerOut = (event: PointerEvent) => {
      const target = tooltipTarget(event.target);
      if (target && !target.contains(event.relatedTarget as Node | null)) hide();
    };
    // Keyboard focus shows the control's own tooltip, or else the one on a label inside it (a truncated row title),
    // so a tooltip is reachable wherever its text sits within something focusable.
    const onFocusIn = (event: FocusEvent) => {
      const focused = event.target;
      if (!(focused instanceof HTMLElement) || !focused.matches(':focus-visible')) return;
      const target = focused.hasAttribute('data-tooltip')
        ? focused
        : focused.querySelector<HTMLElement>('[data-tooltip]');
      if (target) show(target, true, focused);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };
    document.addEventListener('pointerover', onPointerOver);
    document.addEventListener('pointerout', onPointerOut);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', hide);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', hide, true);
    return () => {
      window.clearTimeout(timer.current);
      document.removeEventListener('pointerover', onPointerOver);
      document.removeEventListener('pointerout', onPointerOut);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('scroll', hide, true);
    };
  }, [hide, show]);

  // A control that changes its tooltip while it shows (a pending label that settles) is read from the attribute
  // again, so the bubble never keeps describing a state that is over.
  useEffect(() => {
    if (!active) return undefined;
    const { target } = active;
    const observer = new MutationObserver(() => {
      const text = target.dataset.tooltip?.trim();
      if (!text || repeatsVisibleText(target, text)) hide();
      else
        setActive((current) => (current?.target === target && current.text !== text ? { ...current, text } : current));
    });
    observer.observe(target, { attributes: true, attributeFilter: ['data-tooltip'] });
    return () => observer.disconnect();
  }, [active, hide]);

  // The bubble keeps showing the last text while its exit plays.
  useEffect(() => {
    if (active) setShown(active);
  }, [active]);

  useEffect(() => {
    if (!active || active.text === accessibleName(active.owner)) return undefined;
    const { owner } = active;
    const previous = owner.getAttribute('aria-describedby');
    owner.setAttribute('aria-describedby', previous ? `${previous} ${id}` : id);
    return () => {
      if (previous) owner.setAttribute('aria-describedby', previous);
      else owner.removeAttribute('aria-describedby');
    };
  }, [active, id]);

  useLayoutEffect(() => {
    const bubble = bubbleRef.current;
    if (!active || !bubble) {
      if (!presence.mounted) setPosition((current) => (current.ready ? { ...current, ready: false } : current));
      return;
    }
    const anchor = active.target.getBoundingClientRect();
    const width = bubble.offsetWidth;
    const height = bubble.offsetHeight;
    const below = anchor.bottom + ANCHOR_GAP;
    const top = below + height + VIEWPORT_MARGIN <= window.innerHeight ? below : anchor.top - ANCHOR_GAP - height;
    const centered = anchor.left + anchor.width / 2 - width / 2;
    const left = Math.max(VIEWPORT_MARGIN, Math.min(centered, window.innerWidth - width - VIEWPORT_MARGIN));
    setPosition({ left, top: Math.max(VIEWPORT_MARGIN, top), ready: true });
  }, [active, shown, presence.mounted]);

  if (!presence.mounted || !shown || typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={bubbleRef}
      id={id}
      role="tooltip"
      className="ui-tooltip"
      data-state={presence.state}
      data-ready={position.ready ? 'true' : 'false'}
      {...positionStyle}
    >
      {shown.text}
    </div>,
    document.body,
  );
}
