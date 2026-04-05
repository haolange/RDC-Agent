import { randomUUID } from 'crypto';
import type { GraphState } from '../../../shared/types/workflow';
import {
  createBlocker,
  createStageTransitionEvidence,
  nowIso,
} from './utils';
import { BLOCKER_CODES } from '../../../shared/constants/blockers';

export async function specialistBriefsNode(
  state: GraphState,
): Promise<Partial<GraphState>> {
  const evidenceChain: GraphState['evidenceChain'] = [];
  const activeSpecialists: GraphState['activeSpecialists'] = { ...state.activeSpecialists };
  const collectedBriefs: GraphState['collectedBriefs'] = { ...state.collectedBriefs };
  const blockers: GraphState['blockers'] = [...state.blockers];

  evidenceChain.push(
    createStageTransitionEvidence(
      {
        sessionId: state.sessionId,
        runId: state.runId,
        currentStage: state.currentStage,
      },
      'dispatch',
    ),
  );

  const specialistIds = state.pendingBriefs.length > 0 ? state.pendingBriefs : Object.keys(activeSpecialists);
  let completedCount = 0;
  let failedCount = 0;

  for (const agentId of specialistIds) {
    const specialist = activeSpecialists[agentId];
    if (!specialist) {
      continue;
    }

    if (specialist.status === 'completed' && specialist.brief) {
      collectedBriefs[agentId] = specialist.brief;
      completedCount += 1;
      continue;
    }

    if (specialist.status === 'failed' || specialist.status === 'timeout') {
      failedCount += 1;
    }
  }

  if (completedCount === 0 && specialistIds.length > 0) {
    blockers.push(
      createBlocker(
        BLOCKER_CODES.BLOCKED_SPECIALIST_FEEDBACK_TIMEOUT.code,
        'No specialist brief was collected from the dispatch phase.',
        specialistIds,
      ),
    );
  }

  evidenceChain.push({
    eventId: randomUUID(),
    eventType: 'dispatch_complete',
    agentId: 'rdc-debugger',
    status: blockers.length > state.blockers.length ? 'blocked' : 'ok',
    timestamp: Date.now(),
    payload: {
      collectedBriefsCount: Object.keys(collectedBriefs).length,
      totalSpecialists: specialistIds.length,
      completedCount,
      failedCount,
      runId: state.runId,
      sessionId: state.sessionId,
    },
  });

  return {
    currentStage: 'dispatch',
    stageHistory: [state.currentStage],
    evidenceChain,
    activeSpecialists,
    collectedBriefs,
    pendingBriefs: [],
    blockers,
    lastUpdated: nowIso(),
  };
}

export function routeAfterSpecialistBriefs(state: GraphState): string {
  const hasCriticalBlocker = state.blockers.some((blocker) => !blocker.resolvedAt && blocker.code.startsWith('BLOCKED_'));
  if (hasCriticalBlocker) {
    return 'blocked';
  }
  return 'investigate';
}
