import { describe, expect, it } from 'vitest';
import { extractDollarSkillRefs, mergeTurnPreloadSkillIds } from './turnSkillRefs';

describe('extractDollarSkillRefs', () => {
  it('extracts unique kebab-case skill ids', () => {
    expect(extractDollarSkillRefs('Use $debug and $rdc-context then $debug again'))
      .toEqual(['debug', 'rdc-context']);
  });

  it('ignores invalid tokens', () => {
    expect(extractDollarSkillRefs('price $12 and $1bad')).toEqual([]);
  });
});

describe('mergeTurnPreloadSkillIds', () => {
  it('merges profile, dollar refs, and pending without duplicates', () => {
    expect(mergeTurnPreloadSkillIds({
      profileSkills: ['verify', 'debug'],
      messageText: 'please $debug and $simplify',
      pendingSkillIds: ['simplify', 'remember'],
    })).toEqual(['verify', 'debug', 'simplify', 'remember']);
  });
});
