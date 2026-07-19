/**
 * HarnessProfileResolver — per-model harness 丰俭裁决。
 *
 * 零 schema 路线：`.agent.md` frontmatter 的显式 `harness: lean | standard`
 * 优先；未声明时按模型事实启发（小上下文窗口或无 reasoning → lean）。
 * Provider manifest 的 `harnessHints` 字段留待事实沉淀，本模块不读 manifest。
 */

import type { ReasoningControlKind } from '@shared/types/modelCapability';
import type { AgentHarnessPreference } from '@shared/types/agentManifest';

export type HarnessProfileId = 'lean' | 'standard';

export type HarnessProfileSource =
  | 'manifest'
  | 'heuristic:small-context'
  | 'heuristic:no-reasoning'
  | 'default';

export interface HarnessProfile {
  id: HarnessProfileId;
  source: HarnessProfileSource;
  /** 是否注入 skill catalog 段（空 catalog 一律省略；lean 仅在 profile 声明 skills 时注入）。 */
  includeSkillCatalog: boolean;
  /** Skill catalog 字符预算（lean 减半，下限 1000）。 */
  catalogCharBudget: number;
}

export interface HarnessProfileInput {
  /** `.agent.md` frontmatter 显式偏好；缺省走启发式。 */
  manifestHarness?: AgentHarnessPreference;
  /** profile 声明的 preload skill 数。 */
  declaredSkillCount: number;
  /** 当前有效 skill catalog 条目数。 */
  skillCatalogCount: number;
  contextWindowTokens?: number;
  reasoningKind?: ReasoningControlKind;
}

/** 小窗口阈值：低于该值的模型默认收窄 harness。 */
export const HARNESS_LEAN_CONTEXT_WINDOW_TOKENS = 64_000;

const baseCatalogCharBudget = (contextWindowTokens?: number): number => (
  Number.isFinite(contextWindowTokens) && (contextWindowTokens as number) > 0
    ? Math.max(1000, Math.floor((contextWindowTokens as number) * 0.02 * 4))
    : 8000
);

export function resolveHarnessProfile(input: HarnessProfileInput): HarnessProfile {
  let id: HarnessProfileId;
  let source: HarnessProfileSource;

  if (input.manifestHarness === 'lean' || input.manifestHarness === 'standard') {
    id = input.manifestHarness;
    source = 'manifest';
  } else if (
    Number.isFinite(input.contextWindowTokens)
    && (input.contextWindowTokens as number) > 0
    && (input.contextWindowTokens as number) < HARNESS_LEAN_CONTEXT_WINDOW_TOKENS
  ) {
    id = 'lean';
    source = 'heuristic:small-context';
  } else if (input.reasoningKind === 'none') {
    id = 'lean';
    source = 'heuristic:no-reasoning';
  } else {
    id = 'standard';
    source = 'default';
  }

  const includeSkillCatalog = input.skillCatalogCount > 0
    && (id === 'standard' || input.declaredSkillCount > 0);
  const base = baseCatalogCharBudget(input.contextWindowTokens);
  const catalogCharBudget = id === 'lean' ? Math.max(1000, Math.floor(base / 2)) : base;

  return { id, source, includeSkillCatalog, catalogCharBudget };
}
