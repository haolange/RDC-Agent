import React from 'react';
import { useI18n } from '../../i18n';
import { Chevron } from '../../ui/Chevron';

/** A gap this small at the bottom still counts as "at the latest". */
const BOTTOM_SLACK = 24;
const FOLLOW_MS = 200;

const prefersReducedMotion = () => typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeOut = (progress: number) => 1 - (1 - progress) ** 3;

/**
 * The "follow latest" window of a running process: a height-capped scroller that eases to the newest content as it
 * arrives and fades out toward the top. Scrolling up pauses following and offers「回到最新」; reaching the bottom
 * resumes it. When not following (the process ended, or the preference is "show all") the same element simply lays
 * its content out in full, so switching never remounts the rows or loses their open state.
 */
export const WorkProcessViewport: React.FC<{ following: boolean; children: React.ReactNode }> = ({ following, children }) => {
  const { t } = useI18n();
  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const stick = React.useRef(true);
  const animating = React.useRef(0);
  const [paused, setPaused] = React.useState(false);
  const [hiddenAbove, setHiddenAbove] = React.useState(false);

  const scrollToLatest = React.useCallback((smooth: boolean) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    window.cancelAnimationFrame(animating.current);
    const target = scroller.scrollHeight - scroller.clientHeight;
    const from = scroller.scrollTop;
    if (!smooth || prefersReducedMotion() || Math.abs(target - from) < 2) {
      scroller.scrollTop = target;
      animating.current = 0;
      return;
    }
    const startedAt = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / FOLLOW_MS);
      scroller.scrollTop = from + (scroller.scrollHeight - scroller.clientHeight - from) * easeOut(progress);
      animating.current = progress < 1 ? window.requestAnimationFrame(step) : 0;
    };
    animating.current = window.requestAnimationFrame(step);
  }, []);

  React.useLayoutEffect(() => {
    if (!following) {
      window.cancelAnimationFrame(animating.current);
      stick.current = true;
      setPaused(false);
      setHiddenAbove(false);
      return undefined;
    }
    scrollToLatest(false);
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      if (stick.current) scrollToLatest(true);
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [following, scrollToLatest]);

  React.useEffect(() => () => window.cancelAnimationFrame(animating.current), []);

  const onScroll = () => {
    const scroller = scrollerRef.current;
    if (!scroller || !following) return;
    setHiddenAbove(scroller.scrollTop > 0);
    if (animating.current) return;
    const atBottom = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= BOTTOM_SLACK;
    stick.current = atBottom;
    setPaused(!atBottom);
  };

  return (
    <div className={`work-process-viewport${following ? ' is-following' : ''}${following && hiddenAbove ? ' has-hidden-above' : ''}`}>
      <div ref={scrollerRef} className="work-process-viewport-scroller" onScroll={onScroll}>
        <div ref={contentRef}>{children}</div>
      </div>
      {following && paused ? (
        <button type="button" className="work-process-viewport-latest"
          onClick={() => { stick.current = true; setPaused(false); scrollToLatest(true); }}>
          <Chevron direction="down" size={12} />
          {t('chat.workProcessBackToLatest')}
        </button>
      ) : null}
    </div>
  );
};
