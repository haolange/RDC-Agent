import { SubagentRunner, type SystemPromptSource } from '../agent-runtime/orchestration/SubagentRunner';
import type { AgentProfileTurnOptions } from '../agent-runtime/orchestration/orchestratorTypes';
import type { AgentRole } from '@shared/types/agent';
import type { ActiveTurnLookup } from '../agent-runtime/orchestration/orchestratorTypes';

/** Wires a SubagentRunner from test doubles of its ports: child profile turns, prompts and active turns. */
export function wireSubagentRunner(doubles: {
  sendProfileMessage: (agentId: AgentRole, content: string, options?: AgentProfileTurnOptions) => Promise<string>;
  systemPromptForAgent: SystemPromptSource['systemPromptForAgent'];
  getActiveTurn: ActiveTurnLookup['getActiveTurn'];
}): SubagentRunner {
  const runner = new SubagentRunner({
    prompts: { systemPromptForAgent: doubles.systemPromptForAgent },
    activeTurns: { getActiveTurn: doubles.getActiveTurn },
  });
  runner.bindProfileTurns({
    runChildTurn: ({ agentId, content, ...options }) => doubles.sendProfileMessage(agentId, content, options),
  });
  return runner;
}
