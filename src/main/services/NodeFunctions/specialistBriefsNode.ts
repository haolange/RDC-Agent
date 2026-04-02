/**
 * specialistBriefsNode.ts - Specialist Briefs 收集阶段节点
 * 汇总所有 Specialist 返回的 brief，检查超时和失败情况
 */

import type { GraphState, SpecialistState } from '../../../shared/types/workflow';
import type { AgentRole } from '../../../shared/types/agent';
import { DEFAULT_TOKEN_TTL_SECONDS } from '../../../shared/constants/agents';
import {
  createStageTransitionEvidence,
  createSpecialistCompleteEvidence,
  createBlocker,
  nowIso,
} from './utils';
import { BLOCKER_CODES } from '../../../shared/constants/blockers';

/** Specialist Briefs 节点配置 */
export interface SpecialistBriefsConfig {
  /** 超时时间（秒），默认 1800 */
  timeoutSeconds?: number;
  /** 最大重试次数 */
  maxRetries?: number;
}

/**
 * 检查 specialist 是否超时
 */
function isSpecialistTimeout(
  specialist: SpecialistState,
  timeoutSeconds: number
): boolean {
  if (!specialist.startedAt) return false;
  const startTime = new Date(specialist.startedAt).getTime();
  const currentTime = Date.now();
  return (currentTime - startTime) > timeoutSeconds * 1000;
}

/**
 * Specialist Briefs 收集节点
 * 汇总所有 specialist 返回的 brief，处理超时和失败
 */
export async function specialistBriefsNode(
  state: GraphState,
  config: SpecialistBriefsConfig = {}
): Promise<Partial<GraphState>> {
  const timeoutSeconds = config.timeoutSeconds || DEFAULT_TOKEN_TTL_SECONDS;
  const maxRetries = config.maxRetries || 3;
  const evidenceChain: GraphState['evidenceChain'] = [];
  const blockers: GraphState['blockers'] = [];
  const activeSpecialists: GraphState['activeSpecialists'] = { ...state.activeSpecialists };
  const collectedBriefs: GraphState['collectedBriefs'] = { ...state.collectedBriefs };
  const backtrackCount: GraphState['backtrackCount'] = { ...state.backtrackCount };

  // 记录进入 specialist_briefs_collected 阶段
  evidenceChain.push(
    createStageTransitionEvidence(
      {
        sessionId: state.sessionId,
        runId: state.runId,
        currentStage: state.currentStage,
      },
      'specialist_briefs_collected'
    )
  );

  // 检查所有 active specialists 的状态
  const specialistEntries = Object.entries(activeSpecialists);
  let completedCount = 0;
  let failedCount = 0;
  let timeoutCount = 0;

  for (const [agentId, specialist] of specialistEntries) {
    // 检查是否超时
    if (specialist.status === 'running' && isSpecialistTimeout(specialist, timeoutSeconds)) {
      specialist.status = 'timeout';
      specialist.error = `Timeout after ${timeoutSeconds}s`;
      timeoutCount++;

      // 记录超时证据
      evidenceChain.push({
        eventId: crypto.randomUUID(),
        eventType: 'specialist_timeout',
        agentId: agentId as AgentRole,
        status: 'timeout',
        timestamp: Date.now(),
        payload: {
          agentId,
          timeoutSeconds,
          startedAt: specialist.startedAt,
          runId: state.runId,
          sessionId: state.sessionId,
        },
      });

      // 检查是否需要 backtrack
      const currentRetryCount = backtrackCount['specialist_timeout'] || 0;
      if (currentRetryCount < maxRetries) {
        backtrackCount['specialist_timeout'] = currentRetryCount + 1;
      } else {
        // 超过最大重试次数，创建 blocker
        blockers.push(
          createBlocker(
            BLOCKER_CODES.BLOCKED_VALIDATION_FAILED.code,
            `Specialist ${agentId} timed out after ${maxRetries} retries`,
            [agentId]
          )
        );
      }
    }

    // 处理完成的 specialist
    if (specialist.status === 'completed' && specialist.brief) {
      if (!collectedBriefs[agentId]) {
        collectedBriefs[agentId] = specialist.brief;
        completedCount++;

        // 记录完成证据
        evidenceChain.push(
          createSpecialistCompleteEvidence(
            { sessionId: state.sessionId, runId: state.runId },
            agentId as AgentRole,
            specialist.brief,
            specialist.artifacts
          )
        );
      }
    }

    // 处理失败的 specialist
    if (specialist.status === 'failed') {
      failedCount++;
      evidenceChain.push({
        eventId: crypto.randomUUID(),
        eventType: 'specialist_failed',
        agentId: agentId as AgentRole,
        status: 'failed',
        timestamp: Date.now(),
        payload: {
          agentId,
          error: specialist.error,
          runId: state.runId,
          sessionId: state.sessionId,
        },
      });
    }
  }

  // 记录汇总结果
  evidenceChain.push({
    eventId: crypto.randomUUID(),
    eventType: 'specialist_briefs_summary',
    agentId: 'rdc-debugger',
    status: 'ok',
    timestamp: Date.now(),
    payload: {
      totalSpecialists: specialistEntries.length,
      completedCount,
      failedCount,
      timeoutCount,
      collectedBriefsCount: Object.keys(collectedBriefs).length,
      runId: state.runId,
      sessionId: state.sessionId,
    },
  });

  return {
    currentStage: 'specialist_briefs_collected',
    stageHistory: [state.currentStage],
    evidenceChain,
    blockers: [...state.blockers, ...blockers],
    activeSpecialists,
    collectedBriefs,
    backtrackCount,
    lastUpdated: nowIso(),
  };
}

/**
 * Specialist Briefs 后路由函数
 * 决定下一个节点：expert_investigation 或 validation_blocked 或 backtrack
 */
export function routeAfterSpecialistBriefs(state: GraphState): string {
  // 检查是否有阻断器
  const hasCriticalBlocker = state.blockers.some(
    b => !b.resolvedAt && b.code.startsWith('BLOCKED_')
  );

  if (hasCriticalBlocker) {
    return 'validation_blocked';
  }

  // 检查是否需要 backtrack（specialist 超时且未达到最大重试）
  const hasTimeoutSpecialist = Object.values(state.activeSpecialists).some(
    s => s.status === 'timeout'
  );
  const retryCount = state.backtrackCount['specialist_timeout'] || 0;

  if (hasTimeoutSpecialist && retryCount < 3) {
    // 返回到 specialist_dispatch 重新分派
    return 'specialist_dispatch';
  }

  // 检查是否有足够的 briefs 进入下一阶段
  const collectedCount = Object.keys(state.collectedBriefs).length;
  const totalSpecialists = Object.keys(state.activeSpecialists).length;

  if (collectedCount === 0 && totalSpecialists > 0) {
    // 所有 specialist 都失败了，阻断
    return 'validation_blocked';
  }

  // 正常流程：进入 expert_investigation
  return 'expert_investigation';
}
