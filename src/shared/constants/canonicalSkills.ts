/**
 * Canonical builtin Skill inventory for T12.
 * 22 Mission / Knowledge / Coordinator + 9 general. No orphan, duplicate, or legacy names.
 */

import { isMissionAgentId } from '../types/agent';

export const GENERAL_SKILL_IDS = [
  'debug',
  'verify',
  'simplify',
  'remember',
  'rdc-context',
  'rdx-cli-shell',
  'debugger-rdx-tools',
  'analyzer-rdx-tools',
  'optimizer-rdx-tools',
] as const;

export const MISSION_KNOWLEDGE_COORDINATOR_SKILL_IDS = [
  'execution-orchestrator',
  'debugger-coordinator',
  'analyzer-coordinator',
  'optimizer-coordinator',
  'debugger-causal-method',
  'analyzer-architecture-method',
  'optimization-experiment',
  'skeptic-review',
  'report-composition',
  'renderdoc-execution',
  'renderdoc-investigation',
  'capture-preflight',
  'capture-facts',
  'artifact-provenance',
  'pass-graph-analysis',
  'shader-ir-analysis',
  'pixel-forensics',
  'resource-versioning',
  'cross-capture-alignment',
  'knowledge-scout',
  'knowledge-candidate',
  'renderdoc-glossary',
] as const;

export const CANONICAL_SKILL_IDS = [
  ...MISSION_KNOWLEDGE_COORDINATOR_SKILL_IDS,
  ...GENERAL_SKILL_IDS,
] as const;

export type CanonicalSkillId = (typeof CANONICAL_SKILL_IDS)[number];
export type SkillCallEntry = 'agent.md-skills' | 'task-matched-or-explicit';
export type CanonicalSkillLane = 'general' | 'mission-knowledge-coordinator';

/** Skills whose tool surface conflicts with Mission plan-only and must stay on General. */
export const PLAN_ONLY_CONFLICT_SKILL_IDS = [
  'rdx-cli-shell',
  'debugger-rdx-tools',
  'analyzer-rdx-tools',
  'optimizer-rdx-tools',
] as const;

export const SKILL_ARMED_BY_PROFILE: Record<string, readonly string[]> = {
  general: ['execution-orchestrator'],
  debugger: ['debugger-coordinator'],
  analyzer: ['analyzer-coordinator'],
  optimizer: ['optimizer-coordinator'],
};

const ARMED_SKILL_IDS = new Set(Object.values(SKILL_ARMED_BY_PROFILE).flat());

export const FORBIDDEN_SKILL_NAMES = [
  'ask',
  'plan',
  'edit',
  'bash',
  'todo',
  'harness',
  'classic',
  'legacy',
] as const;

export function skillCallEntry(id: string): SkillCallEntry {
  return ARMED_SKILL_IDS.has(id) ? 'agent.md-skills' : 'task-matched-or-explicit';
}

export function skillLane(id: string): CanonicalSkillLane | null {
  if ((GENERAL_SKILL_IDS as readonly string[]).includes(id)) return 'general';
  if ((MISSION_KNOWLEDGE_COORDINATOR_SKILL_IDS as readonly string[]).includes(id)) {
    return 'mission-knowledge-coordinator';
  }
  return null;
}

export function isPlanOnlyConflictSkill(id: string): boolean {
  return (PLAN_ONLY_CONFLICT_SKILL_IDS as readonly string[]).includes(id);
}

/** Mission profiles cannot discover or load plan-only-conflict skills such as rdx-cli-shell. */
export function isSkillVisibleToProfile(profileId: string, skillId: string): boolean {
  if (!isMissionAgentId(profileId)) return true;
  return !isPlanOnlyConflictSkill(skillId);
}
