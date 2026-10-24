// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaptureReplayState } from '@shared/types/captureReplay';
import { CaptureWorkspace } from './CaptureWorkspace';
import { applyReplayEvent } from './capturePanelActions';

vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string, args?: Record<string, unknown>) => `${key}${args ? JSON.stringify(args) : ''}` }) }));
vi.mock('./capturePanelActions', () => ({ applyReplayEvent: vi.fn() }));
vi.mock('./useCapturePreview', () => ({ useCapturePreview: (_scope: unknown, source: { imagePath?: string }) => ({
  url: source.imagePath || null, loading: false, error: false,
}) }));
const scope = { projectId: 'project', sessionId: 'session' };
const image = { imagePath: 'live:1:42', width: 16, height: 16, source: 'framebuffer_screenshot' as const, updatedAt: 1 };
const replay = (): CaptureReplayState => ({ ...scope, generation: 1, operationId: null, revision: 1, phase: 'ready', inputId: 'input', captureHash: 'hash', contextId: 'context', replayDeviceId: 'local',
  requestedEventId: 42, appliedEventId: 42, imageEventId: 42, events: [{ eventId: 21 }, { eventId: 42 }], targets: [{ textureId: 'color', outputSlot: 0 }], target: { textureId: 'color', outputSlot: 0 }, isFinalOutput: false, image,
  devicePresentation: { status: 'presented', eventId: 42, textureId: 'color', sequence: 1, reason: null }, interactionLock: null, error: null, warning: null, observation: null,
});
let root: Root, host: HTMLDivElement, state: CaptureReplayState;
const receive = vi.fn();
const render = async (overrides = {}) => { await act(async () => root.render(createElement(CaptureWorkspace, {
  scope, state, disabled: false, receive, ...overrides,
}))); };
const input = () => host.querySelector<HTMLInputElement>('.capture-event-input input')!;
const controls = () => [...host.querySelectorAll<HTMLInputElement | HTMLButtonElement>('.capture-replay-content[role="group"] input, .capture-replay-content[role="group"] button')];
const click = async (label: string) => { await act(async () => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click()); };
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks();
  state = replay(); host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  vi.mocked(applyReplayEvent).mockImplementation(async request => ({ ...state, requestedEventId: request.eventId,
    appliedEventId: request.eventId, imageEventId: request.eventId, revision: state.revision + 1 }));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('one EID replay track', () => {
  it('does not replay when tabbing through an unchanged event input or slider', async () => {
    await render();
    await act(async () => { input().focus(); input().blur(); });
    const slider = host.querySelector<HTMLInputElement>('input[type="range"]')!;
    await act(async () => slider.dispatchEvent(new KeyboardEvent('keyup', { key: 'Tab', bubbles: true })));
    expect(applyReplayEvent).not.toHaveBeenCalled();
  });
  it('does not replay a drag value again on release after the debounce already applied it', async () => {
    vi.useFakeTimers(); await render();
    const slider = host.querySelector<HTMLInputElement>('input[type="range"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, '0');
      slider.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(input().value).toBe('21');
    await act(async () => vi.advanceTimersByTime(100));
    expect(applyReplayEvent).toHaveBeenCalledTimes(1);
    await act(async () => slider.dispatchEvent(new Event('pointerup', { bubbles: true })));
    expect(applyReplayEvent).toHaveBeenCalledTimes(1);
  });
  it.each(['agent_running', 'delegated_execution', 'native_exit_unconfirmed'])('keeps the same controls and image through %s and follows Agent EID changes', async lock => {
    await render();
    const field = input(), slider = host.querySelector('input[type="range"]'), viewport = host.querySelector('.capture-replay-image');
    expect(host.querySelectorAll('input[type="range"]')).toHaveLength(1);
    expect(host.querySelector('details, [role="tablist"]')).toBeNull();
    expect(input().value).toBe('42'); expect(input().disabled).toBe(false);
    state = { ...state, interactionLock: lock, revision: 2 }; await render();
    expect(input()).toBe(field); expect(host.querySelector('.capture-replay-image')).toBe(viewport);
    expect(controls().every(control => control.disabled)).toBe(true);
    expect(host.querySelector('img')?.getAttribute('src')).toBe(image.imagePath);
    await click('control.replay.previous'); expect(applyReplayEvent).not.toHaveBeenCalled();
    state = { ...state, requestedEventId: 21, appliedEventId: 21, imageEventId: 21,
      image: { ...image, imagePath: 'live:1:21', updatedAt: 2 }, revision: 3 }; await render();
    expect(input().value).toBe('21'); expect(host.querySelector('input[type="range"]')).toBe(slider);
    expect(host.querySelector('img')?.getAttribute('src')).toBe('live:1:21');
    state = { ...state, interactionLock: null, revision: 4 }; await render();
    expect(input()).toBe(field); expect(input().disabled).toBe(false);
    expect(applyReplayEvent).not.toHaveBeenCalled();
    await click('control.replay.next');
    expect(applyReplayEvent).toHaveBeenCalledExactlyOnceWith({ ...scope, bindingGeneration: 1, eventId: 42 });
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({ appliedEventId: 42 }));
  });
  it('discards a debounced manual position when Agent takes control before dispatch', async () => {
    vi.useFakeTimers(); await render();
    const slider = host.querySelector<HTMLInputElement>('input[type="range"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, '0'); slider.dispatchEvent(new Event('change', { bubbles: true })); });
    state = { ...state, interactionLock: 'agent_running', revision: 2 }; await render();
    await act(async () => vi.advanceTimersByTime(200));
    expect(input().value).toBe('42'); expect(applyReplayEvent).not.toHaveBeenCalled();
  });
  it('keeps requested and shown events distinct while applying and does not relabel the old image', async () => {
    state = { ...state, requestedEventId: 21, phase: 'applying' }; await render();
    expect(input().value).toBe('21'); expect(host.querySelector('img')?.getAttribute('alt')).toBe('EID 42');
    expect(host.textContent).toContain('"requested":21,"shown":42');
  });
  it('keeps controls in place but disables them and clears stale pixels after closing', async () => {
    await render(); state = { ...state, contextId: null, phase: 'closed', image: null, imageEventId: null, revision: 2 }; await render();
    expect(host.querySelectorAll('input[type="range"]')).toHaveLength(1);
    expect(controls().every(control => control.disabled)).toBe(true);
    expect(host.querySelector('img')).toBeNull(); expect(host.textContent).not.toContain('control.replay.synced');
  });
});
