import { describe, expect, it } from 'vitest';
import { summarizeSourceChange } from './versionChangeSummary';

describe('summarizeSourceChange', () => {
  it('counts duplicate-line additions and removals without persisting a full diff', () => {
    expect(summarizeSourceChange('one\ntwo\ntwo', 'one\ntwo\nthree')).toMatchObject({
      added: 1, removed: 1,
      samples: expect.arrayContaining([{ kind: 'added', text: 'three' }, { kind: 'removed', text: 'two' }]),
    });
  });
});
