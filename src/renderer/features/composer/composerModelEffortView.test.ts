import { describe, expect, it } from 'vitest';
import { nextComposerModelEffortView } from './composerModelEffortView';

describe('composer model-effort popup view', () => {
  it('opens the existing model list from the Codex panel and returns after choose or Escape', () => {
    expect(nextComposerModelEffortView('effort', 'open-models')).toBe('models');
    expect(nextComposerModelEffortView('models', 'chosen')).toBe('effort');
    expect(nextComposerModelEffortView('models', 'escape')).toBe('effort');
    expect(nextComposerModelEffortView('models', 'menu-closed')).toBe('effort');
    expect(nextComposerModelEffortView('effort', 'escape')).toBe('effort');
  });
});
