import { SubagentRunner, type ProfileTurnSender, type SystemPromptSource } from '../agent-runtime/orchestration/SubagentRunner';
import type { ActiveTurnLookup } from '../agent-runtime/orchestration/orchestratorTypes';

/** Wires a SubagentRunner from test doubles of its three ports: child profile turns, prompts and active turns. */
export function wireSubagentRunner(doubles: {
  sendProfileMessage: ProfileTurnSender['sendProfileMessage'];
  systemPromptForAgent: SystemPromptSource['systemPromptForAgent'];
  getActiveTurn: ActiveTurnLookup['getActiveTurn'];
}): SubagentRunner {
  const runner = new SubagentRunner({
    prompts: { systemPromptForAgent: doubles.systemPromptForAgent },
    activeTurns: { getActiveTurn: doubles.getActiveTurn },
  });
  runner.bindProfileTurns({ sendProfileMessage: doubles.sendProfileMessage });
  return runner;
}
