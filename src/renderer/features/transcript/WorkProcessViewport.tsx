import React from 'react';
import { useI18n } from '../../i18n';
import { Chevron } from '../../ui/Chevron';
import { assignDynStyles, clearDynStyles } from '../../lib/useDynStyle';
import { PlainButton } from '../../ui/PlainButton';

/** A gap this small at the bottom still counts as "at the latest". */
const BOTTOM_SLACK = 24;
const FOLLOW_MS = 200;

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeOut = (progress: number) => 1 - (1 - progress) ** 3;

/**
 * The "follow latest" window of a running process: a height-capped scroller that eases to the newest content as it
 * arrives and fades out toward the top. Scrolling up pauses following and offers「回到最新」; reaching the bottom
 * resumes it. When not following (the process ended, or the preference is "show all") the same element simply lays
 * its content out in full, so switching never remounts the rows or loses their open state.
 *
 * A scroll event reads no layout itself: following animates one scroll per frame, and reading the geometry in the
 * event forced a layout whenever the transcript had changed since the last frame. The position is read once in the
 * next animation frame instead, and "at the bottom" is judged against the heights from the last layout read (what
 * the reader saw), so content added in that frame does not count as the reader leaving the bottom.
 */
export const WorkProcessViewport: React.FC<{ following: boolean; children: React.ReactNode }> = ({
  following,
  children,
}) => {
  const { t } = useI18n();
  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const stick = React.useRef(true);
  const animating = React.useRef(0);
  /** The frame that reads the scroll position after a scroll event; 0 when none is pending. */
  const scrollRead = React.useRef(0);
  const laidOut = React.useRef({ scrollHeight: 0, clientHeight: 0 });
  const [paused, setPaused] = React.useState(false);
  const [hiddenAbove, setHiddenAbove] = React.useState(false);

  /** Reads the scroller's heights and keeps them as the geometry the reader last saw. */
  const readLayout = React.useCallback((scroller: HTMLDivElement) => {
    laidOut.current = { scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight };
    return laidOut.current.scrollHeight - laidOut.current.clientHeight;
  }, []);

  const scrollToLatest = React.useCallback(
    (smooth: boolean) => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      window.cancelAnimationFrame(animating.current);
      const target = readLayout(scroller);
      const from = scroller.scrollTop;
      if (!smooth || prefersReducedMotion() || Math.abs(target - from) < 2) {
        scroller.scrollTop = target;
        animating.current = 0;
        return;
      }
      const startedAt = performance.now();
      const step = (now: number) => {
        const progress = Math.min(1, (now - startedAt) / FOLLOW_MS);
        scroller.scrollTop = from + (readLayout(scroller) - from) * easeOut(progress);
        animating.current = progress < 1 ? window.requestAnimationFrame(step) : 0;
      };
      animating.current = window.requestAnimationFrame(step);
    },
    [readLayout],
  );

  const readScroll = React.useCallback(() => {
    scrollRead.current = 0;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const top = scroller.scrollTop;
    setHiddenAbove(top > 0);
    if (animating.current) return;
    const atBottom = laidOut.current.scrollHeight - laidOut.current.clientHeight - top <= BOTTOM_SLACK;
    stick.current = atBottom;
    setPaused(!atBottom);
  }, []);

  React.useLayoutEffect(() => {
    if (!following) {
      window.cancelAnimationFrame(animating.current);
      window.cancelAnimationFrame(scrollRead.current);
      scrollRead.current = 0;
      stick.current = true;
      setPaused(false);
      setHiddenAbove(false);
      return undefined;
    }
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return undefined;
    let gutter = -1;
    const measureGutter = () => {
      const next = scroller.offsetWidth - scroller.clientWidth;
      if (next === gutter) return;
      gutter = next;
      assignDynStyles([[scroller, { '--work-scrollbar-gutter': `${gutter}px` }]]);
    };
    measureGutter();
    scrollToLatest(false);
    if (typeof ResizeObserver === 'undefined') return () => clearDynStyles([scroller]);
    const observer = new ResizeObserver(() => {
      // Observations arrive after layout: settle a pending scroll first, then keep the new heights.
      if (scrollRead.current) {
        window.cancelAnimationFrame(scrollRead.current);
        readScroll();
      }
      measureGutter();
      readLayout(scroller);
      if (stick.current) scrollToLatest(true);
    });
    observer.observe(content);
    observer.observe(scroller);
    return () => {
      observer.disconnect();
      clearDynStyles([scroller]);
    };
  }, [following, readLayout, readScroll, scrollToLatest]);

  React.useEffect(
    () => () => {
      window.cancelAnimationFrame(animating.current);
      window.cancelAnimationFrame(scrollRead.current);
    },
    [],
  );

  const onScroll = () => {
    if (!scrollerRef.current || !following) return;
    if (!scrollRead.current) scrollRead.current = window.requestAnimationFrame(readScroll);
  };

  return (
    <div
      className={`work-process-viewport${following ? ' is-following' : ''}${following && hiddenAbove ? ' has-hidden-above' : ''}`}
    >
      <div ref={scrollerRef} className="work-process-viewport-scroller" onScroll={onScroll}>
        <div ref={contentRef}>{children}</div>
      </div>
      {following && paused ? (
        <PlainButton
          className="work-process-viewport-latest"
          onClick={() => {
            stick.current = true;
            setPaused(false);
            scrollToLatest(true);
          }}
        >
          <Chevron direction="down" size={12} />
          {t('chat.workProcessBackToLatest')}
        </PlainButton>
      ) : null}
    </div>
  );
};
