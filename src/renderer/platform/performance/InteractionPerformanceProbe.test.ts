import { describe, expect, it } from 'vitest';
import { summarizeInteractionPerformance } from './InteractionPerformanceProbe';

describe('summarizeInteractionPerformance', () => {
  it('reports a deterministic p95 and long-task maximum', () => {
    const snapshot = summarizeInteractionPerformance(
      20,
      [24, 40],
      [51.2346, 63.4567],
      true,
      true,
    );

    expect(snapshot).toEqual({
      schemaVersion: 2,
      measurement: 'event-timing-click-to-next-paint',
      interactionCount: 20,
      sampleCount: 20,
      pointerToPaintP95Ms: 24,
      pointerToPaintMaxMs: 40,
      eventTimingSupported: true,
      eventTimingThresholdMs: 16,
      eventTimingObservedCount: 2,
      longTaskSupported: true,
      longTaskCount: 2,
      longTaskMaxMs: 63.457,
    });
  });

  it('does not manufacture measurements before an interaction', () => {
    expect(summarizeInteractionPerformance(0, [], [], false, false)).toMatchObject({
      interactionCount: 0,
      sampleCount: 0,
      pointerToPaintP95Ms: null,
      pointerToPaintMaxMs: null,
      eventTimingSupported: false,
      eventTimingObservedCount: 0,
      longTaskSupported: false,
      longTaskCount: 0,
      longTaskMaxMs: null,
    });
  });
});
