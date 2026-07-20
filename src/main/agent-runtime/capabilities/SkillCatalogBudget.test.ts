/**
 * SkillCatalogBudget 单元测试。
 */
import { describe, expect, it } from 'vitest';
import { resolveSkillCatalogBudget } from './SkillCatalogBudget';

describe('resolveSkillCatalogBudget', () => {
  it('includes a non-empty catalog for large and small windows', () => {
    const large = resolveSkillCatalogBudget({
      skillCatalogCount: 3,
      contextWindowTokens: 200_000,
    });
    expect(large.includeSkillCatalog).toBe(true);
    expect(large.catalogCharBudget).toBe(Math.floor(200_000 * 0.02 * 4));

    const small = resolveSkillCatalogBudget({
      skillCatalogCount: 3,
      contextWindowTokens: 32_000,
    });
    expect(small.includeSkillCatalog).toBe(true);
    expect(small.catalogCharBudget).toBe(Math.max(1000, Math.floor(32_000 * 0.02 * 4)));
  });

  it('always omits an empty catalog', () => {
    const profile = resolveSkillCatalogBudget({
      skillCatalogCount: 0,
      contextWindowTokens: 200_000,
    });
    expect(profile.includeSkillCatalog).toBe(false);
  });

  it('falls back to 8000 chars without a window estimate', () => {
    const profile = resolveSkillCatalogBudget({ skillCatalogCount: 2 });
    expect(profile.includeSkillCatalog).toBe(true);
    expect(profile.catalogCharBudget).toBe(8000);
  });

  it('floors tiny-window budgets at 1000 chars', () => {
    const tiny = resolveSkillCatalogBudget({
      skillCatalogCount: 3,
      contextWindowTokens: 4_000,
    });
    expect(tiny.catalogCharBudget).toBe(1000);
  });
});
