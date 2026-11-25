import { describe, expect, it } from 'vitest';
import { nextComposerModelEffortView } from './composerModelEffortView';

describe('composer model-effort popup view', () => {
  it('opens the existing model list from the Codex panel and returns after choose or Escape', () => {
    expect(nextComposerModelEffortView('open-models')).toBe('models');
    expect(nextComposerModelEffortView('chosen')).toBe('effort');
    expect(nextComposerModelEffortView('escape')).toBe('effort');
    expect(nextComposerModelEffortView('menu-closed')).toBe('effort');
  });
});
