/**
 * finalizeNode.ts - Finalize 最终收尾阶段节点
 * 最终收尾节点，确认所有证据链完整，更新状态到 finalized
 */

import { randomUUID } from 'crypto';
import type { GraphState } from '../../../shared/types/workflow';
import {
  createStageTransitionEvidence,
  nowIso,
} from './utils';

/** Finalize 节点配置 */
export interface FinalizeConfig {
  /** 是否归档证据链 */
  archiveEvidence?: boolean;
  /** 是否清理临时数据 */
  cleanupTempData?: boolean;
}

/**
 * Finalize 节点
 * 最终收尾，确认所有证据链完整
 */
export async function finalizeNode(
  state: GraphState,
  _config: FinalizeConfig = {}
): Promise<Partial<GraphState>> {
  const evidenceChain: GraphState['evidenceChain'] = [];

  // 记录进入 finalized 阶段
  evidenceChain.push(
    createStageTransitionEvidence(
      {
        sessionId: state.sessionId,
        runId: state.runId,
        currentStage: state.currentStage,
      },
      'finalize',
      'rdc-debugger'
    )
  );

  // 统计工作流执行数据
  const stageTransitionCount = state.evidenceChain.filter(
    e => e.eventType === 'workflow_stage_transition'
  ).length;

  const specialistCount = Object.keys(state.activeSpecialists).length;
  const completedSpecialists = Object.values(state.activeSpecialists).filter(
    s => s.status === 'completed'
  ).length;

  const artifactCount = state.artifacts.length;
  const totalEvidenceCount = state.evidenceChain.length + evidenceChain.length;

  // 记录最终总结证据
  evidenceChain.push({
    eventId: randomUUID(),
    eventType: 'workflow_finalized',
    agentId: 'rdc-debugger',
    status: 'ok',
    timestamp: Date.now(),
    payload: {
      caseId: state.caseId,
      runId: state.runId,
      sessionId: state.sessionId,
      finalStage: 'finalize',
      totalStages: stageTransitionCount,
      specialistCount,
      completedSpecialists,
      artifactCount,
      totalEvidenceCount,
      fixVerified: state.fixVerified,
      hasFinalReport: !!state.finalReport,
      finalReportConfidence: state.finalReport?.confidence || 0,
      startedAt: state.stageHistory[0] || state.currentStage,
      completedAt: nowIso(),
      duration: Date.now(), // 简化处理，实际应该计算开始时间
    },
  });

  // 如果有报告，记录报告摘要
  if (state.finalReport) {
    evidenceChain.push({
      eventId: randomUUID(),
      eventType: 'final_report_summary',
      agentId: 'curator_agent',
      status: 'ok',
      timestamp: Date.now(),
      payload: {
        title: state.finalReport.title,
        summary: state.finalReport.summary.substring(0, 500),
        confidence: state.finalReport.confidence,
        evidenceCount: state.finalReport.evidenceSummary.length,
        recommendationCount: state.finalReport.recommendations.length,
        runId: state.runId,
        sessionId: state.sessionId,
      },
    });
  }

  // 记录证据链完整性检查
  const evidenceTypes = new Set(state.evidenceChain.map(e => e.eventType));
  const requiredEvidenceTypes = [
    'workflow_stage_transition',
    'speclist_complete',
    'dispatch_complete',
    'specialist_complete',
    'expert_investigation_complete',
    'fix_verification_result',
    'skeptic_review_complete',
    'curator_report_generated',
  ];

  const missingEvidenceTypes = requiredEvidenceTypes.filter(
    type => !evidenceTypes.has(type)
  );

  evidenceChain.push({
    eventId: randomUUID(),
    eventType: 'evidence_chain_validation',
    agentId: 'rdc-debugger',
    status: missingEvidenceTypes.length === 0 ? 'ok' : 'warning',
    timestamp: Date.now(),
    payload: {
      totalEvidenceEvents: totalEvidenceCount,
      uniqueEvidenceTypes: Array.from(evidenceTypes),
      missingEvidenceTypes,
      evidenceChainComplete: missingEvidenceTypes.length === 0,
      runId: state.runId,
      sessionId: state.sessionId,
    },
  });

  return {
    currentStage: 'finalize',
    stageHistory: [state.currentStage],
    evidenceChain,
    lastUpdated: nowIso(),
  };
}

// 注意：finalize 是终端节点，不需要路由函数
// 在 WorkflowGraph 中直接连接到 END
