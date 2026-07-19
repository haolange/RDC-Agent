/**
 * HarnessProfileResolver 单元测试。
 */
import { describe, expect, it } from 'vitest';
import {
  HARNESS_LEAN_CONTEXT_WINDOW_TOKENS,
  resolveHarnessProfile,
} from './HarnessProfileResolver';

describe('resolveHarnessProfile', () => {
  it('defaults to standard for large-window reasoning models', () => {
    const profile = resolveHarnessProfile({
      declaredSkillCount: 0,
      skillCatalogCount: 3,
      contextWindowTokens: 200_000,
      reasoningKind: 'levels',
    });
    expect(profile.id).toBe('standard');
    expect(profile.source).toBe('default');
    expect(profile.includeSkillCatalog).toBe(true);
  });

  it('picks lean for small context windows', () => {
    const profile = resolveHarnessProfile({
      declaredSkillCount: 0,
      skillCatalogCount: 3,
      contextWindowTokens: HARNESS_LEAN_CONTEXT_WINDOW_TOKENS - 1,
      reasoningKind: 'levels',
    });
    expect(profile.id).toBe('lean');
    expect(profile.source).toBe('heuristic:small-context');
    expect(profile.includeSkillCatalog).toBe(false);
  });

  it('picks lean for models without reasoning', () => {
    const profile = resolveHarnessProfile({
      declaredSkillCount: 0,
      skillCatalogCount: 3,
      contextWindowTokens: 200_000,
      reasoningKind: 'none',
    });
    expect(profile.id).toBe('lean');
    expect(profile.source).toBe('heuristic:no-reasoning');
  });

  it('explicit manifest preference overrides heuristics', () => {
    const lean = resolveHarnessProfile({
      manifestHarness: 'lean',
      declaredSkillCount: 0,
      skillCatalogCount: 3,
      contextWindowTokens: 400_000,
      reasoningKind: 'levels',
    });
    expect(lean.id).toBe('lean');
    expect(lean.source).toBe('manifest');

    const standard = resolveHarnessProfile({
      manifestHarness: 'standard',
      declaredSkillCount: 0,
      skillCatalogCount: 3,
      contextWindowTokens: 8_000,
      reasoningKind: 'none',
    });
    expect(standard.id).toBe('standard');
    expect(standard.source).toBe('manifest');
    expect(standard.includeSkillCatalog).toBe(true);
  });

  it('lean keeps the catalog when the profile declares skills', () => {
    const profile = resolveHarnessProfile({
      manifestHarness: 'lean',
      declaredSkillCount: 2,
      skillCatalogCount: 3,
      contextWindowTokens: 200_000,
    });
    expect(profile.includeSkillCatalog).toBe(true);
  });

  it('always omits an empty catalog', () => {
    const profile = resolveHarnessProfile({
      declaredSkillCount: 2,
      skillCatalogCount: 0,
      contextWindowTokens: 200_000,
    });
    expect(profile.includeSkillCatalog).toBe(false);
  });

  it('halves the catalog budget for lean with a floor of 1000 chars', () => {
    const standard = resolveHarnessProfile({
      declaredSkillCount: 1,
      skillCatalogCount: 3,
      contextWindowTokens: 200_000,
    });
    const lean = resolveHarnessProfile({
      manifestHarness: 'lean',
      declaredSkillCount: 1,
      skillCatalogCount: 3,
      contextWindowTokens: 200_000,
    });
    expect(standard.catalogCharBudget).toBe(Math.floor(200_000 * 0.02 * 4));
    expect(lean.catalogCharBudget).toBe(Math.floor(standard.catalogCharBudget / 2));

    const tiny = resolveHarnessProfile({
      manifestHarness: 'lean',
      declaredSkillCount: 1,
      skillCatalogCount: 3,
      contextWindowTokens: 4_000,
    });
    expect(tiny.catalogCharBudget).toBe(1000);
  });
});
