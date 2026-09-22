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
  // Threshold-imputed estimate, not a measured latency for missing entries.
  // Missing entries can also be pending delivery or have an unavailable target.
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
 * QA only. Scope defaults to Composer; transcript measures its real buttons and
 * disclosures. An optional window measures page-wide LongTasks from installation,
 * including streaming without clicks. LongTasks cannot be attributed to a feature.
 */
export function installInteractionPerformanceProbe(): () => void {
  const query = new URLSearchParams(window.location.search);
  const noop = () => {};
  if (query.get(PERFORMANCE_QUERY_KEY) !== '1') return noop;
  if (document.documentElement.dataset.rdcQaPerformanceInstalled === 'true') return noop;

  const scope = query.get('qaPerformanceScope') === 'transcript' ? 'transcript' : 'composer';
  const selector = scope === 'transcript'
    ? '[data-testid="conversation-thread"] button, [data-testid="conversation-thread"] summary'
    : COMPOSER_CONTROL_SELECTOR;
  const requestedWindow = Number(query.get('qaPerformanceWindowMs'));
  const windowMs = Number.isFinite(requestedWindow) && requestedWindow >= 1 && requestedWindow <= 300_000
    ? requestedWindow : null;
  const installedAt = performance.now();
  const deadline = windowMs === null ? Infinity : installedAt + windowMs;
  document.documentElement.dataset.rdcQaPerformanceInstalled = 'true';
  const eventTimingSamples: number[] = [];
  const longTaskSamples: number[] = [];
  const observedEventStartTimes = new Set<number>();
  const observers: PerformanceObserver[] = [];
  let interactionCount = 0;
  let observationStartedAt: number | null = windowMs === null ? null : installedAt;
  let stoppedAt: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const eventTimingSupported = typeof PerformanceObserver !== 'undefined'
    && PerformanceObserver.supportedEntryTypes.includes('event');
  const longTaskSupported = typeof PerformanceObserver !== 'undefined'
    && PerformanceObserver.supportedEntryTypes.includes('longtask');

  const publish = () => {
    document.documentElement.setAttribute(PERFORMANCE_ATTRIBUTE, JSON.stringify({
      ...summarizeInteractionPerformance(
        interactionCount, eventTimingSamples, longTaskSamples,
        eventTimingSupported, longTaskSupported,
      ),
      scope,
      longTaskScope: 'page',
      eventTimingEstimation: 'missing-clicks-imputed-at-threshold',
      eventTimingAttribution: 'connected-target-selector',
      observationWindowMs: windowMs,
      observationStartedAt,
      observationEndedAt: stoppedAt,
      observationDurationMs: observationStartedAt === null ? 0
        : roundMilliseconds(Math.min(stoppedAt ?? performance.now(), deadline) - observationStartedAt),
      status: stoppedAt === null ? 'recording' : 'stopped',
    }));
  };
  const consume = (entries: PerformanceEntry[]) => {
    for (const rawEntry of entries) {
      if (rawEntry.startTime >= deadline) continue;
      if (rawEntry.entryType === 'event') {
        if (rawEntry.name !== 'click' || rawEntry.startTime < installedAt) continue;
        const entry = rawEntry as PerformanceEventTiming;
        if (!(entry.target instanceof Element) || !entry.target.closest(selector)) continue;
        if (observedEventStartTimes.has(entry.startTime)) continue;
        observedEventStartTimes.add(entry.startTime);
        eventTimingSamples.push(entry.duration);
      } else if (rawEntry.entryType === 'longtask') {
        // Include the task carrying the first click, even when it started before
        // the click listener. Bounded windows use the same overlap definition.
        if (observationStartedAt === null || rawEntry.startTime + rawEntry.duration < observationStartedAt) continue;
        longTaskSamples.push(rawEntry.duration);
      }
    }
    publish();
  };
  const observe = (options: PerformanceObserverInit) => {
    const observer = new PerformanceObserver((list) => {
      if (stoppedAt === null) consume(list.getEntries());
    });
    observer.observe(options);
    observers.push(observer);
  };
  if (eventTimingSupported) observe({
    type: 'event', buffered: true, durationThreshold: EVENT_TIMING_THRESHOLD_MS,
  } as PerformanceObserverInit);
  if (longTaskSupported) observe({ type: 'longtask', buffered: true });

  const onClick = (event: MouseEvent) => {
    if (performance.now() >= deadline) return;
    if (!(event.target instanceof Element)) return;
    const control = event.target.closest(selector);
    if (!control || (control instanceof HTMLButtonElement && control.disabled)) return;
    observationStartedAt ??= performance.now();
    interactionCount += 1;
    publish();
  };
  const dispose = () => {
    if (stoppedAt !== null) return;
    // Drain native entries before disconnecting; no RAF or tool-call timing proxy.
    for (const observer of observers) consume(observer.takeRecords());
    stoppedAt = Math.min(performance.now(), deadline);
    for (const observer of observers) observer.disconnect();
    if (timer !== undefined) clearTimeout(timer);
    document.removeEventListener('click', onClick, true);
    window.removeEventListener('pagehide', dispose);
    delete document.documentElement.dataset.rdcQaPerformanceInstalled;
    publish();
  };
  document.addEventListener('click', onClick, { capture: true });
  window.addEventListener('pagehide', dispose, { once: true });
  if (windowMs !== null) timer = setTimeout(dispose, windowMs);
  publish();
  return dispose;
}
