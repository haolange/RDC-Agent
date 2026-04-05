import { randomUUID } from 'crypto';
import { Send } from '@langchain/langgraph';
import type { GraphState } from '../../../shared/types/workflow';
import type { AgentRole } from '../../../shared/types/agent';
import { INVESTIGATOR_AGENTS } from '../../../shared/constants/agents';
import {
  createDispatchEvidence,
  createInitialSpecialistState,
  createStageTransitionEvidence,
  nowIso,
} from './utils';

export interface SpecialistDispatchConfig {
  forceDispatch?: AgentRole[];
  skipAgents?: AgentRole[];
}

function selectSpecialists(state: GraphState, config: SpecialistDispatchConfig): AgentRole[] {
  if (config.forceDispatch && config.forceDispatch.length > 0) {
    return config.forceDispatch;
  }

  const intentEvent = state.evidenceChain.find((event) => event.eventType === 'intent_analysis_complete');
  const recommendedAgents = Array.isArray(intentEvent?.payload?.recommendedAgents)
    ? intentEvent!.payload.recommendedAgents as AgentRole[]
    : INVESTIGATOR_AGENTS;

  return recommendedAgents.filter((agentId) => INVESTIGATOR_AGENTS.includes(agentId) && !config.skipAgents?.includes(agentId));
}

function generateObjective(agentRole: AgentRole, state: GraphState): string {
  return [
    `Case ID: ${state.caseId}`,
    `Run ID: ${state.runId}`,
    `Session ID: ${state.sessionId}`,
    `User Goal: ${state.userGoal}`,
    `Capture Files: ${state.capturePaths.join(', ')}`,
    '',
    'Deliver a specialist brief with concrete evidence, likely root cause, and next verification target.',
    `Focus area: ${agentRole}`,
  ].join('\n');
}

export async function specialistDispatchNode(
  state: GraphState,
  config: SpecialistDispatchConfig = {},
): Promise<Partial<GraphState>> {
  const evidenceChain: GraphState['evidenceChain'] = [];
  const activeSpecialists: GraphState['activeSpecialists'] = { ...state.activeSpecialists };
  const pendingBriefs: string[] = [];
  const selectedAgents = selectSpecialists(state, config);

  evidenceChain.push(
    createStageTransitionEvidence(
      {
        sessionId: state.sessionId,
        runId: state.runId,
        currentStage: state.currentStage,
      },
      'speclist',
    ),
  );

  for (const agentRole of selectedAgents) {
    const objective = generateObjective(agentRole, state);
    activeSpecialists[agentRole] = {
      ...createInitialSpecialistState(agentRole),
      objective,
      status: 'pending',
      startedAt: nowIso(),
    };
    pendingBriefs.push(agentRole);
    evidenceChain.push(
      createDispatchEvidence(
        { sessionId: state.sessionId, runId: state.runId },
        agentRole,
        objective,
        `tok-${randomUUID()}`,
      ),
    );
  }

  evidenceChain.push({
    eventId: randomUUID(),
    eventType: 'speclist_complete',
    agentId: 'rdc-debugger',
    status: 'ok',
    timestamp: Date.now(),
    payload: {
      selectedAgents,
      selectedCount: selectedAgents.length,
      runId: state.runId,
      sessionId: state.sessionId,
    },
  });

  return {
    currentStage: 'speclist',
    stageHistory: [state.currentStage],
    evidenceChain,
    activeSpecialists,
    pendingBriefs,
    lastUpdated: nowIso(),
  };
}

export function createSpecialistSends(state: GraphState, config: SpecialistDispatchConfig = {}): Send[] {
  return selectSpecialists(state, config).map((agentRole) => (
    new Send('dispatch', {
      specialistTaskAgent: agentRole,
      specialistTaskObjective: generateObjective(agentRole, state),
    })
  ));
}

export function routeAfterSpecialistDispatch(state: GraphState): string {
  const hasCriticalBlocker = state.blockers.some((blocker) => !blocker.resolvedAt && blocker.code.startsWith('BLOCKED_'));
  if (hasCriticalBlocker) {
    return 'blocked';
  }
  return 'dispatch';
}
