// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ComposerModelEffortControl, type ComposerModelSaveState } from './ComposerModelEffortControl';
import type { PreparedTurnContextSummary } from '@shared/types/session';
import { ComposerMenuRegistryProvider } from './useComposerMenuRegistry';
const mock = vi.hoisted(() => ({ controls: { saveState: { saving: false }, retrySave: () => {}, capabilityState: { status: 'ready' } }, choice: false, commit: vi.fn(), clear: vi.fn(), save: vi.fn() }));
vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string, params?: Record<string, string | number>) => key === 'composer.effort.reasoningValue' ? `模型思考：${params?.level}` : key }) }));
vi.mock('../../stores/appSettingsStore', () => ({ useAppSettingsStore: (select: (state: unknown) => unknown) => select({
  settings: { llm: { providers: [] }, agents: { definitions: [
    { id: 'debugger', name: 'Debugger', compiledRoute: { providerId: 'p', modelId: 'model' } },
  ] } },
}) }));
vi.mock('../../hooks/useComposerEffectiveModel', () => ({ useComposerEffectiveModel: () => ({
  effective: { providerId: 'p', modelId: 'model' }, hasChoice: mock.choice, projectId: 'project',
}) }));
vi.mock('./useComposerModelPickerOptions', () => ({ useComposerModelPickerOptions: () => ({
  options: [{ providerId: 'p', providerLabel: 'Provider', modelId: 'model', label: 'Model', aliases: [],
    contextWindowTokens: 1000, contextWindowLabel: '1k', hasReasoning: true }], loading: false, failedProviders: [], retry: vi.fn(),
}) }));
vi.mock('./ComposerTurnControlsContext', () => ({ useComposerTurnControls: () => mock.controls }));
vi.mock('./sessionModelOverride', () => ({ commitComposerModelChoice: mock.commit, clearComposerModelChoice: mock.clear }));
vi.mock('./useComposerEffortControl', () => ({ useComposerEffortControl: () => ({
  effortLabel: 'Low', selectedLevel: 'low', turnControls: { maxContextMode: false, fastModel: false }, sliderHandlers: {},
}) }));
vi.mock('./ComposerModelEffortPanel', () => ({ ComposerModelEffortPanel: ({ onOpenModels }: { onOpenModels: () => void }) =>
  createElement('button', { onClick: onOpenModels, 'data-testid': 'open-models' }, 'Effort') }));
let root: Root; let host: HTMLDivElement;
const render = (review = true, scope = 'first') => act(async () => root.render(createElement(ComposerMenuRegistryProvider, {
  key: scope,
  children: createElement(ComposerModelEffortControl, { agentId: 'debugger', currentSession: null,
    showAgentDefault: review, onSaveStateChange: (state: ComposerModelSaveState) => mock.save(state) }),
})));
const click = (selector: string) => act(async () => host.querySelector<HTMLButtonElement>(selector)!.click());
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  mock.choice = false; mock.controls.capabilityState.status = 'ready'; vi.clearAllMocks();
  mock.commit.mockImplementation(async () => { mock.choice = true; return { ok: true }; });
  mock.clear.mockImplementation(async () => { mock.choice = false; return { ok: true }; });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
it('opens effort directly in review while retaining the shared agent-default choice', async () => {
  await render();
  expect(host.querySelector('[data-testid="composer-model-effort-pill"]')?.textContent).toBe('composer.model.agentDefault');
  expect(host.querySelector('.composer-model-effort-pill-level')).toBeNull();
  await click('[data-testid="composer-model-effort-pill"]');
  expect(host.querySelector('[data-testid="open-models"]')).not.toBeNull();
  await click('[data-testid="open-models"]');
  expect(host.querySelector('[data-testid="composer-model-search"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="composer-model-agent-default"]')?.textContent).toBe('composer.model.agentDefault');
  await click('[role="menuitemradio"]:not([data-testid="composer-model-agent-default"])');
  expect(mock.commit).toHaveBeenCalledOnce();
  expect(host.querySelector('[data-testid="composer-model-effort-pill"]')?.textContent).toBe('ModelLow');
  expect(host.querySelector('[data-testid="composer-model-effort-pill"]')?.getAttribute('aria-label')).toContain('模型思考：Low');
  expect(host.querySelector('[data-testid="open-models"]')).not.toBeNull();
  await click('[data-testid="open-models"]');
  await click('[data-testid="composer-model-agent-default"]');
  expect(mock.clear).toHaveBeenCalledOnce();
  expect(host.querySelector('[data-testid="composer-model-effort-pill"]')?.textContent).toBe('composer.model.agentDefault');
  expect(host.querySelector('[data-testid="composer-model-search"]')).toBeNull();
});
it('preserves the normal Composer model and effort label without an override', async () => {
  await render(false);
  expect(host.querySelector('[data-testid="composer-model-effort-pill"]')?.textContent).toBe('ModelLow');
  expect(host.querySelector('[data-testid="composer-model-effort-pill"]')?.getAttribute('aria-label')).toContain('模型思考：Low');
});

it('shows the main-confirmed request while disabled, and hides stale draft labels during preparation', async () => {
  const paint = (prepared: PreparedTurnContextSummary | null, preparing: boolean) => act(async () => root.render(
    createElement(ComposerMenuRegistryProvider, { children: createElement(ComposerModelEffortControl, {
      agentId: 'debugger', currentSession: null, disabled: true, prepared, preparing,
    }) })));
  await paint(null, true);
  expect(host.textContent).toContain('Model');
  expect(host.textContent).toContain('Low');
  expect(host.querySelector('[data-testid="composer-model-effort-pill"]')?.getAttribute('title')).toContain('composer.model.preparing');
  await paint({ route: { providerId: 'p', effectiveModelId: 'confirmed-model' },
    controls: { reasoningLevel: 'high', fastModel: true, maxContextMode: true } } as PreparedTurnContextSummary, false);
  expect(host.textContent).toContain('confirmed-model');
  expect(host.textContent).toContain('composer.effort.levelHigh');
  expect(host.querySelector<HTMLButtonElement>('[data-testid="composer-model-effort-pill"]')!.disabled).toBe(true);
});

it('retains the choice but labels an invalid provider as unavailable', async () => {
  mock.choice = true; mock.controls.capabilityState.status = 'unavailable';
  await render(false);
  expect(host.textContent).toBe('composer.model.unavailable');
  expect(mock.clear).not.toHaveBeenCalled();
});
it('keeps the save barrier after closing the popup and reports a failed save without changing the model', async () => {
  let finish!: (result: { ok: boolean }) => void;
  mock.commit.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await render(); await click('[data-testid="composer-model-effort-pill"]'); await click('[data-testid="open-models"]');
  await click('[role="menuitemradio"]:not([data-testid="composer-model-agent-default"])');
  expect(mock.save).toHaveBeenLastCalledWith({ saving: true });
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  expect(host.querySelector('[data-testid="composer-model-search"]')).toBeNull();
  expect(host.querySelector<HTMLButtonElement>('[data-testid="composer-model-effort-pill"]')!.disabled).toBe(true);
  await act(async () => finish({ ok: false }));
  expect(mock.save).toHaveBeenLastCalledWith({ saving: false, error: 'composer.model.saveFailed' });
  expect(host.querySelector('[data-testid="composer-model-effort-pill"]')?.textContent).toBe('composer.model.agentDefault');
});

it('does not deliver an old save failure into the next session or plan revision', async () => {
  let finish!: (result: { ok: boolean }) => void;
  mock.commit.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await render(); await click('[data-testid="composer-model-effort-pill"]'); await click('[data-testid="open-models"]');
  await click('[role="menuitemradio"]:not([data-testid="composer-model-agent-default"])');
  await render(true, 'next');
  mock.save.mockClear();
  await act(async () => finish({ ok: false }));
  expect(mock.save).not.toHaveBeenCalled();
  expect(host.querySelector<HTMLButtonElement>('[data-testid="composer-model-effort-pill"]')!.disabled).toBe(false);
  expect(host.querySelector('[data-testid="composer-model-search"]')).toBeNull();
});
