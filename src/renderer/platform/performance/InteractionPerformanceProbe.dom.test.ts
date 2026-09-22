// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installInteractionPerformanceProbe } from './InteractionPerformanceProbe';

class Observer {
  static supportedEntryTypes = ['event', 'longtask'];
  static instances: Observer[] = [];
  options?: PerformanceObserverInit;
  disconnect = vi.fn();
  records: PerformanceEntry[] = [];
  constructor(private callback: PerformanceObserverCallback) { Observer.instances.push(this); }
  observe(options: PerformanceObserverInit) { this.options = options; }
  takeRecords() { return this.records.splice(0); }
  emit(entries: PerformanceEntry[]) {
    this.callback({ getEntries: () => entries } as PerformanceObserverEntryList,
      this as unknown as PerformanceObserver);
  }
}
const snapshot = () => JSON.parse(document.documentElement.getAttribute('data-rdc-qa-performance')!);
const entry = (entryType: string, startTime: number, duration: number, target?: Element) =>
  ({ entryType, startTime, duration, name: 'click', target, toJSON: () => ({}) });
let dispose: (() => void) | undefined;

beforeEach(() => {
  Observer.instances = [];
  vi.stubGlobal('PerformanceObserver', Observer);
  vi.spyOn(performance, 'now').mockReturnValue(100);
  window.history.replaceState({}, '', '/app');
  document.body.innerHTML = `<div data-testid="conversation-thread">
    <div data-testid="work-process-tool-card"><button><span>Tool</span></button></div>
    <details data-testid="work-process-tool-aggregate"><summary>Tools</summary></details>
  </div><div data-testid="composer-effort-fast-row"><button role="switch">Fast</button></div>`;
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.documentElement.removeAttribute('data-rdc-qa-performance');
  delete document.documentElement.dataset.rdcQaPerformanceInstalled;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('query-gated native performance probe', () => {
  it('installs nothing on normal product paths', () => {
    dispose = installInteractionPerformanceProbe();
    document.querySelector<HTMLButtonElement>('button')!.click();
    expect(Observer.instances).toHaveLength(0);
    expect(document.documentElement.hasAttribute('data-rdc-qa-performance')).toBe(false);
  });

  it('retains default Composer click counting and excludes transcript clicks', () => {
    window.history.replaceState({}, '', '/app?qaPerformance=1');
    dispose = installInteractionPerformanceProbe();
    installInteractionPerformanceProbe()();
    document.querySelector<HTMLButtonElement>('button')!.click();
    document.querySelector<HTMLButtonElement>('[role="switch"]')!.click();
    expect(snapshot()).toMatchObject({ scope: 'composer', interactionCount: 1, sampleCount: 1 });
    expect(Observer.instances).toHaveLength(2);
  });

  it('measures real transcript controls and native page LongTasks during a bounded window', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    window.history.replaceState({}, '', '/app?qaPerformance=1&qaPerformanceScope=transcript&qaPerformanceWindowMs=1000');
    dispose = installInteractionPerformanceProbe();
    const [events, tasks] = Observer.instances;
    const button = document.querySelector<HTMLButtonElement>('button')!;
    tasks.emit([entry('longtask', 20, 60), entry('longtask', 110, 70)]);
    expect(snapshot()).toMatchObject({ interactionCount: 0, longTaskCount: 1, longTaskScope: 'page' });
    button.querySelector<HTMLElement>('span')!.click();
    document.querySelector<HTMLElement>('summary')!.click();
    document.querySelector<HTMLButtonElement>('[role="switch"]')!.click();
    events.emit([entry('event', 50, 80, button), entry('event', 120, 24, button),
      entry('event', 120, 24, button), entry('event', 130, 40, document.querySelector('summary')!)]);
    expect(snapshot()).toMatchObject({ interactionCount: 2, eventTimingObservedCount: 2,
      pointerToPaintP95Ms: 40, longTaskMaxMs: 70 });
    tasks.records.push(entry('longtask', 200, 90));
    vi.mocked(performance.now).mockReturnValue(1100);
    vi.advanceTimersByTime(1000);
    expect(snapshot()).toMatchObject({ status: 'stopped', observationDurationMs: 1000, longTaskCount: 2 });
    button.click();
    events.emit([entry('event', 1500, 100, button)]);
    expect(snapshot().interactionCount).toBe(2);
    expect(snapshot().eventTimingObservedCount).toBe(2);
    for (const observer of Observer.instances) expect(observer.disconnect).toHaveBeenCalledOnce();
  });

  it('releases observers and pending timer on pagehide and permits a fresh installation', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    window.history.replaceState({}, '', '/app?qaPerformance=1&qaPerformanceWindowMs=500');
    dispose = installInteractionPerformanceProbe();
    window.dispatchEvent(new Event('pagehide'));
    expect(snapshot().status).toBe('stopped');
    expect(vi.getTimerCount()).toBe(0);
    dispose();
    for (const observer of Observer.instances) expect(observer.disconnect).toHaveBeenCalledOnce();
    dispose = installInteractionPerformanceProbe();
    expect(snapshot()).toMatchObject({ status: 'recording', interactionCount: 0 });
  });

  it('includes the LongTask carrying the first default-scope click', () => {
    window.history.replaceState({}, '', '/app?qaPerformance=1');
    dispose = installInteractionPerformanceProbe();
    vi.mocked(performance.now).mockReturnValue(150);
    document.querySelector<HTMLButtonElement>('[role="switch"]')!.click();
    Observer.instances[1].emit([entry('longtask', 90, 50), entry('longtask', 120, 60)]);
    expect(snapshot()).toMatchObject({ longTaskCount: 1, longTaskMaxMs: 60 });
  });

  it('keeps the requested cutoff when a busy thread delays its timer callback', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    window.history.replaceState({}, '', '/app?qaPerformance=1&qaPerformanceWindowMs=500');
    dispose = installInteractionPerformanceProbe();
    const control = document.querySelector<HTMLButtonElement>('[role="switch"]')!;
    control.click();
    vi.mocked(performance.now).mockReturnValue(900);
    control.click();
    Observer.instances[0].records.push(entry('event', 200, 24, control), entry('event', 700, 80, control));
    Observer.instances[1].records.push(entry('longtask', 580, 100), entry('longtask', 700, 90));
    vi.advanceTimersByTime(500);
    expect(snapshot()).toMatchObject({ observationEndedAt: 600, observationDurationMs: 500,
      interactionCount: 1, eventTimingObservedCount: 1, longTaskCount: 1, longTaskMaxMs: 100 });
  });
});
