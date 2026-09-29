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

  it('does not invoke Skill names quoted as Markdown code', () => {
    expect(extractDollarSkillRefs('Open an independent `$skeptic-review`; use $debugger-causal-method here.')).toEqual(['debugger-causal-method']);
    expect(extractDollarSkillRefs('Example:\n```text\n$rdc-tool-shell\n```\nUse $renderdoc-execution.')).toEqual(['renderdoc-execution']);
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
