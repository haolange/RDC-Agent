// @vitest-environment happy-dom
import { act, createElement, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ComposerModelEffortPanel } from './ComposerModelEffortPanel';
import type { ReasoningSelection } from '@shared/types/modelCapability';

const noop = () => undefined;
const props = (displayLevels: ReasoningSelection[], displayLevel: ReasoningSelection, onSelectLevel = vi.fn()) => ({
  popupRef: createRef<HTMLDivElement>(),
  popupShiftPx: 0,
  trackRef: createRef<HTMLDivElement>(),
  modelLabel: 'qa-stub:4b',
  onOpenModels: noop,
  capabilityRefreshing: false,
  capabilityRetryLabel: 'retry',
  onRetryCapability: noop,
  hasAdjustableReasoning: true,
  reasoningLabel: displayLevel,
  displayLevel,
  displayLevels,
  displayIndex: displayLevels.indexOf(displayLevel),
  isDragging: false,
  showMaxTrack: false,
  exitingMaxPhase: 'off' as const,
  maxTimeline: { phase: 'idle', revision: 0, fromStopsOpacity: 1, fromEnergy: 0 } as never,
  thumbRatio: 0,
  thumbPercent: 0,
  tooltipLeftPercent: 0,
  tooltipLabel: '',
  trackWidthPx: 200,
  positionTransitionsReady: true,
  maxContextAvailable: false,
  fastModelAvailable: false,
  maxContextMode: false,
  fastModel: false,
  t: (key: string) => key,
  onTrackPointerDown: noop,
  onTrackPointerMove: noop,
  onTrackPointerUp: noop,
  onTrackClick: noop,
  onThumbKeyDown: noop,
  onSelectLevel,
  onToggleMaxContext: noop,
  onToggleFastModel: noop,
  onMaxTimelineComplete: noop,
});

it('uses a switch for on/off reasoning and a slider for real levels', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const select = vi.fn();
  try {
    await act(async () =>
      root.render(createElement(ComposerModelEffortPanel, props(['off', 'medium'], 'off', select))),
    );
    expect(host.querySelector('[data-testid="composer-effort-slider"]')).toBeNull();
    await act(async () => host.querySelector<HTMLInputElement>('[data-testid="composer-effort-switch"]')!.click());
    expect(select).toHaveBeenCalledWith('medium');
    await act(async () => root.render(createElement(ComposerModelEffortPanel, props(['off', 'low', 'high'], 'low'))));
    expect(host.querySelector('[data-testid="composer-effort-switch"]')).toBeNull();
    expect(host.querySelector('[data-testid="composer-effort-slider"]')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
