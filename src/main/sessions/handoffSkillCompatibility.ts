import type { TaskCompletionBinding } from '../agent-runtime/agent/TurnCompletionValidator';
import { isToolAllowedByFrozenAllowlist } from '../workflow/debugger/DebuggerRuntimePolicy';

export function assertHandoffSkillCompatibility(input: {
  binding: TaskCompletionBinding | null;
  agentId: string;
  tools: readonly string[];
  intersection: readonly string[] | null;
  deniedTools: readonly string[];
}): void {
  if (!input.binding) return;
  for (const tool of ['artifact_read', 'agent_handoff']) {
    if (input.deniedTools.includes(tool) || !isToolAllowedByFrozenAllowlist(tool, input.agentId, input.tools)
      || (input.intersection !== null && !isToolAllowedByFrozenAllowlist(tool, input.agentId, input.intersection))) {
      throw new Error('HANDOFF_SKILL_CONFLICT: bound execution cannot read its plan or return under the prepared tool permissions: ' + tool);
    }
  }
}
