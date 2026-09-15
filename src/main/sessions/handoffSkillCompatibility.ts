import { executionOfferRequiredSkillIds } from './handoffSkills';
import { isToolAllowedByFrozenAllowlist } from '../workflow/debugger/DebuggerRuntimePolicy';

export function assertExecutionOfferSkillCompatibility(input: {
  sessionId?: string | null;
  agentId: string;
  tools: readonly string[];
  intersection: readonly string[] | null;
  deniedTools: readonly string[];
}): void {
  if (executionOfferRequiredSkillIds(input.sessionId, input.agentId).length === 0) return;
  const tool = 'artifact_read';
  if (
    input.deniedTools.includes(tool)
    || !isToolAllowedByFrozenAllowlist(tool, input.agentId, input.tools)
    || (input.intersection !== null && !isToolAllowedByFrozenAllowlist(tool, input.agentId, input.intersection))
  ) {
    throw new Error('EXECUTION_OFFER_SKILL_CONFLICT: bound execution cannot read its plan under the prepared tool permissions.');
  }
}
