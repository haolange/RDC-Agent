import { beforeEach, expect, it, vi } from 'vitest';
import type { EffectiveCatalogSnapshot } from '@shared/types/providerCapability';
import { usePlanReviewModelAvailability } from './usePlanReviewModelAvailability';
const catalog = vi.hoisted(() => ({ loading: false, snapshot: null as EffectiveCatalogSnapshot | null }));
vi.mock('../../stores/appSettingsStore', () => ({ useAppSettingsStore: (select: (state: unknown) => unknown) => select({ settings: {
  llm: { providers: [{ id: 'p', enabled: true, isConfigured: true, protocol: 'OpenAIResponses' }] }, agents: { definitions: [
    { id: 'general', compiledRoute: { providerId: 'p', modelId: 'ready' } },
    { id: 'debugger', compiledRoute: { providerId: 'p', modelId: 'removed' } },
  ] },
} }) }));
vi.mock('./useComposerModelPickerOptions', () => ({ useComposerModelPickerOptions: () => ({}) }));
vi.mock('../../stores/effectiveCatalogStore', () => ({
  catalogScopeKey: () => 'scope',
  useEffectiveCatalogStore: (select: (state: unknown) => unknown) => select({ entries: { scope: catalog } }),
}));
beforeEach(() => {
  catalog.loading = false;
  catalog.snapshot = { refreshing: false, models: [{ providerId: 'p', modelId: 'ready', enabled: true,
    availability: 'available', toolCalling: { state: 'supported' }, route: { protocol: 'OpenAIResponses' },
    catalogRevision: 'r', routeRevision: 'route' }] } as EffectiveCatalogSnapshot;
});
it('resolves no override against each declared target and never falls back from an invalid override', () => {
  expect(usePlanReviewModelAvailability(null)('general')).toBe('available');
  expect(usePlanReviewModelAvailability(null)('debugger')).toBe('unavailable');
  expect(usePlanReviewModelAvailability({ providerId: 'p', modelId: 'removed' })('general')).toBe('unavailable');
  expect(usePlanReviewModelAvailability({ providerId: 'p', modelId: 'ready' })('debugger')).toBe('available');
});
it('distinguishes pending discovery from denial and keeps the same session override', () => {
  const override = { providerId: 'p', modelId: 'ready' };
  const ready = catalog.snapshot;
  catalog.snapshot = null; catalog.loading = true;
  expect(usePlanReviewModelAvailability(override)('general')).toBe('loading');
  catalog.snapshot = ready; catalog.loading = false;
  expect(usePlanReviewModelAvailability(override)('general')).toBe('available');
  catalog.snapshot!.models[0].availability = 'unavailable';
  expect(usePlanReviewModelAvailability(override)('general')).toBe('unavailable');
});
