import { expect, it, vi } from 'vitest';
import { usePlanReviewModelAvailability } from './usePlanReviewModelAvailability';
const available = vi.hoisted(() => ({ options: [{ providerId: 'p', modelId: 'ready' }] }));
vi.mock('../../stores/appSettingsStore', () => ({ useAppSettingsStore: (select: (state: unknown) => unknown) => select({ settings: {
  llm: { providers: [] }, agents: { definitions: [
    { id: 'general', compiledRoute: { providerId: 'p', modelId: 'ready' } },
    { id: 'debugger', compiledRoute: { providerId: 'p', modelId: 'removed' } },
  ] },
} }) }));
vi.mock('./useComposerModelPickerOptions', () => ({ useComposerModelPickerOptions: () => available }));
it('resolves no override against each declared target and never falls back from an invalid override', () => {
  expect(usePlanReviewModelAvailability(null)('general')).toBe(true);
  expect(usePlanReviewModelAvailability(null)('debugger')).toBe(false);
  expect(usePlanReviewModelAvailability({ providerId: 'p', modelId: 'removed' })('general')).toBe(false);
  expect(usePlanReviewModelAvailability({ providerId: 'p', modelId: 'ready' })('debugger')).toBe(true);
});
