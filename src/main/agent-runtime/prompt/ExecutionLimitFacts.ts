import type { PromptPlan } from '@shared/types/rdcRuntime';
import { resolveAgentMaxTurns } from '../agent/ExecutionLimits';
import { applyRuntimeFact } from './RuntimeFactSegment';

export function applyExecutionLimitFacts(plan: PromptPlan, limits: {
  policyMaxTurns?: number;
  profileMaxTurns?: number | null;
}): PromptPlan {
  const maximum = resolveAgentMaxTurns(limits.policyMaxTurns, limits.profileMaxTurns);
  return applyRuntimeFact(plan, {
    id: 'runtime:execution-limits', sourcePath: 'runtime://execution-limits',
    content: [
      '# Frozen Execution Limits',
      `Ordinary provider loop maximum for this prepared turn: ${maximum}`,
      'Source: the same profile and compiled policy used by the executable loop; the tighter limit wins.',
      'Each ordinary provider loop, including a no-tool final response, consumes this ceiling. It is not a remaining balance or a tool-call budget.',
      'Auxiliary provider requests such as context compaction must be accounted for separately; this ceiling grants no auxiliary allowance.',
      'A plan cannot raise this ceiling. Task, Capsule, cancellation, wall-time and provider limits may stop execution earlier; never infer their remaining balances from this fact.',
    ].join('\n'),
  });
}
