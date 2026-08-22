export interface InteractionPerformanceSnapshot {
  schemaVersion: 2;
  measurement: 'event-timing-click-to-next-paint';
  interactionCount: number;
  sampleCount: number;
  pointerToPaintP95Ms: number | null;
  pointerToPaintMaxMs: number | null;
  eventTimingSupported: boolean;
  eventTimingThresholdMs: 16;
  eventTimingObservedCount: number;
  longTaskSupported: boolean;
  longTaskCount: number;
  longTaskMaxMs: number | null;
}

const PERFORMANCE_QUERY_KEY = 'qaPerformance';
const PERFORMANCE_ATTRIBUTE = 'data-rdc-qa-performance';
const EVENT_TIMING_THRESHOLD_MS = 16 as const;
const COMPOSER_CONTROL_SELECTOR = [
  '[data-testid="composer-effort-fast-row"] [role="switch"]',
  '[data-testid="composer-effort-max-context-row"] [role="switch"]',
  '[data-testid="composer-effort-slider"]',
].join(',');

function roundMilliseconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function summarizeInteractionPerformance(
  interactionCount: number,
  eventTimingSamples: readonly number[],
  longTaskSamples: readonly number[],
  eventTimingSupported: boolean,
  longTaskSupported: boolean,
): InteractionPerformanceSnapshot {
  const observedEventTimingSamples = eventTimingSupported
    ? eventTimingSamples.slice(0, interactionCount)
    : [];
  // Event Timing omits entries below durationThreshold. Treating those samples
  // as the threshold is conservative: the p95 can only be overstated.
  const unobservedInteractionCount = eventTimingSupported
    ? Math.max(0, interactionCount - observedEventTimingSamples.length)
    : 0;
  const sortedPointerSamples = [
    ...observedEventTimingSamples,
    ...Array.from({ length: unobservedInteractionCount }, () => EVENT_TIMING_THRESHOLD_MS),
  ].sort((left, right) => left - right);
  const p95Index = sortedPointerSamples.length > 0
    ? Math.max(0, Math.ceil(sortedPointerSamples.length * 0.95) - 1)
    : -1;
  const pointerToPaintP95 = p95Index >= 0 ? sortedPointerSamples[p95Index] : undefined;
  const pointerToPaintMax = sortedPointerSamples.at(-1);
  const longTaskMax = longTaskSamples.length > 0 ? Math.max(...longTaskSamples) : undefined;

  return {
    schemaVersion: 2,
    measurement: 'event-timing-click-to-next-paint',
    interactionCount,
    sampleCount: sortedPointerSamples.length,
    pointerToPaintP95Ms: pointerToPaintP95 === undefined ? null : roundMilliseconds(pointerToPaintP95),
    pointerToPaintMaxMs: pointerToPaintMax === undefined ? null : roundMilliseconds(pointerToPaintMax),
    eventTimingSupported,
    eventTimingThresholdMs: EVENT_TIMING_THRESHOLD_MS,
    eventTimingObservedCount: observedEventTimingSamples.length,
    longTaskSupported,
    longTaskCount: longTaskSamples.length,
    longTaskMaxMs: longTaskMax === undefined ? null : roundMilliseconds(longTaskMax),
  };
}

/**
 * Installs a query-gated probe over the real Composer controls. The normal app path
 * returns before registering listeners, observers, timers, or animation frames.
 */
export function installInteractionPerformanceProbe(): void {
  if (new URLSearchParams(window.location.search).get(PERFORMANCE_QUERY_KEY) !== '1') return;
  if (document.documentElement.dataset.rdcQaPerformanceInstalled === 'true') return;

  document.documentElement.dataset.rdcQaPerformanceInstalled = 'true';
  const eventTimingSamples: number[] = [];
  const longTaskSamples: number[] = [];
  const observedEventStartTimes = new Set<number>();
  let interactionCount = 0;
  let firstInteractionStartedAt: number | null = null;
  const eventTimingSupported = typeof PerformanceObserver !== 'undefined'
    && PerformanceObserver.supportedEntryTypes.includes('event');
  const longTaskSupported = typeof PerformanceObserver !== 'undefined'
    && PerformanceObserver.supportedEntryTypes.includes('longtask');

  const publish = () => {
    document.documentElement.setAttribute(
      PERFORMANCE_ATTRIBUTE,
      JSON.stringify(summarizeInteractionPerformance(
        interactionCount,
        eventTimingSamples,
        longTaskSamples,
        eventTimingSupported,
        longTaskSupported,
      )),
    );
  };

  if (eventTimingSupported) {
    const eventObserver = new PerformanceObserver((list) => {
      let changed = false;
      for (const rawEntry of list.getEntries()) {
        if (rawEntry.name !== 'click') continue;
        const entry = rawEntry as PerformanceEventTiming;
        const target = entry.target;
        if (!(target instanceof Element) || !target.closest(COMPOSER_CONTROL_SELECTOR)) continue;
        if (observedEventStartTimes.has(entry.startTime)) continue;
        observedEventStartTimes.add(entry.startTime);
        eventTimingSamples.push(entry.duration);
        changed = true;
      }
      if (changed) publish();
    });
    eventObserver.observe({
      type: 'event',
      buffered: true,
      durationThreshold: EVENT_TIMING_THRESHOLD_MS,
    } as PerformanceObserverInit);
  }

  if (longTaskSupported) {
    const observer = new PerformanceObserver((list) => {
      if (firstInteractionStartedAt === null) return;
      let changed = false;
      for (const entry of list.getEntries()) {
        if (entry.startTime + entry.duration < firstInteractionStartedAt) continue;
        longTaskSamples.push(entry.duration);
        changed = true;
      }
      if (changed) publish();
    });
    observer.observe({ type: 'longtask', buffered: true });
  }

  document.addEventListener('click', (event) => {
    const eventTarget = event.target;
    if (!(eventTarget instanceof Element)) return;
    const control = eventTarget.closest(COMPOSER_CONTROL_SELECTOR);
    if (!control) return;
    if (control instanceof HTMLButtonElement && control.disabled) return;

    const startedAt = performance.now();
    firstInteractionStartedAt ??= startedAt;
    interactionCount += 1;
    publish();
  }, { capture: true });

  publish();
}
