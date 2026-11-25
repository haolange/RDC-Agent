/**
 * Composition root of the agent runtime. It constructs every collaborator of the AgentOrchestrator façade once and
 * hands each the narrow interfaces it declares. The one late binding is the subagent runner's profile turns: a child
 * turn runs through the same façade whose tools include the runner's.
 */

import { enforceMissionTurnCompletion, enforceMissionTurnReadiness } from '../../investigation/missionCompletionContract';
import { TokenizerService } from '../core/TokenizerService';
import { scopedMemoryStores } from '../memory/MemoryStore';
import { AgentOrchestrator } from './AgentOrchestrator';
import { AgentSlotRegistry } from './AgentSlotRegistry';
import { AgentTurnRunner } from './AgentTurnRunner';
import { createBackgroundSubagentService } from './BackgroundSubagentService';
import { DeferredToolActivationTracker } from './DeferredToolActivationTracker';
import { McpConnectionCoordinator } from './McpConnectionCoordinator';
import { ProfileTurnPreparation } from './ProfileTurnPreparation';
import { PromptPlanForTurn } from './PromptPlanForTurn';
import { RuntimeToolAssembly } from './RuntimeToolAssembly';
import { SubagentRunner } from './SubagentRunner';
import { ToolExecutorFactory } from './ToolExecutorFactory';
import { TurnPreparationService } from './TurnPreparationService';
import { turnCoordinator } from './TurnCoordinator';
import { resolveExecutionScopeId } from './executionScope';
import type { ActiveTurnLookup } from './orchestratorTypes';

/** The live turn of a session or scope, as the turn coordinator owns it. */
const activeTurns: ActiveTurnLookup = {
  getActiveTurn: (sessionId) => turnCoordinator.getActive(resolveExecutionScopeId(sessionId)),
};

export function createAgentOrchestrator(): AgentOrchestrator {
  const slots = new AgentSlotRegistry();
  const mcp = new McpConnectionCoordinator();
  const deferredActivation = new DeferredToolActivationTracker();
  const tokenizerService = new TokenizerService();
  const promptPlan = new PromptPlanForTurn();
  slots.initializeDefaults();

  const subagents = new SubagentRunner({ prompts: promptPlan, activeTurns });
  const backgroundSubagents = createBackgroundSubagentService(subagents);
  subagents.setBackgroundStarter((input) => backgroundSubagents.start(input));

  const tools = new RuntimeToolAssembly({
    mcp,
    activeTurns,
    memory: scopedMemoryStores,
    subagentTools: subagents,
    backgroundTools: backgroundSubagents,
  });
  const toolExecutors = new ToolExecutorFactory({ slots, deferredActivation, activeTurns, tools, toolPolicy: tools });
  const turnPrep = new TurnPreparationService({ mcp, deferredActivation, tools });
  const turnRunner = new AgentTurnRunner({
    validateCompletion: enforceMissionTurnCompletion,
    validateCompletionReadiness: enforceMissionTurnReadiness,
    slots,
    deferredActivation,
    tokenizerService,
    tools,
    toolExecutors,
  });

  const orchestrator = new AgentOrchestrator({
    slots,
    mcp,
    deferredActivation,
    promptPlan,
    toolExecutors,
    turnPrep,
    profilePrep: new ProfileTurnPreparation(turnPrep),
    turnRunner,
    backgroundSubagents,
  });
  subagents.bindProfileTurns(orchestrator);
  return orchestrator;
}

export const agentOrchestrator = createAgentOrchestrator();
