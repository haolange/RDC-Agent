/**
 * SkillCatalogBudget — Progressive Skill 索引预算。
 *
 * 非空 metadata catalog 一律注入短索引；预算仅按上下文窗口缩放。
 * 不提供双档 harness 用户选择，也不因窗口/reasoning 整段省略索引。
 */

export interface SkillCatalogBudget {
  /** 是否注入 skill catalog 段（仅当 catalog 非空）。 */
  includeSkillCatalog: boolean;
  /** Skill catalog 字符预算（下限 1000）。 */
  catalogCharBudget: number;
}

export interface SkillCatalogBudgetInput {
  /** 当前有效 skill catalog 条目数。 */
  skillCatalogCount: number;
  contextWindowTokens?: number;
}

export function resolveSkillCatalogBudget(input: SkillCatalogBudgetInput): SkillCatalogBudget {
  const includeSkillCatalog = input.skillCatalogCount > 0;
  const catalogCharBudget = Number.isFinite(input.contextWindowTokens)
    && (input.contextWindowTokens as number) > 0
    ? Math.max(1000, Math.floor((input.contextWindowTokens as number) * 0.02 * 4))
    : 8000;
  return { includeSkillCatalog, catalogCharBudget };
}
