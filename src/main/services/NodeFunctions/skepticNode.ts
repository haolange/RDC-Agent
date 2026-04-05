/**
 * skepticNode.ts - Skeptic 验证阶段节点
 * 调用 skeptic_agent 进行独立验证，审查整个调查过程和修复方案
 */

import { randomUUID } from 'crypto';
import type { GraphState } from '../../../shared/types/workflow';
import type { LLMRequest } from '../../../shared/types/llm';
import { llmAdapter } from '../../adapters/LLMAdapter';
import {
  createStageTransitionEvidence,
  createBlocker,
  nowIso,
  resolveAgentRuntimeConfig,
} from './utils';
import { BLOCKER_CODES } from '../../../shared/constants/blockers';

/** Skeptic 节点配置 */
export interface SkepticConfig {
  /** 最大重试次数 */
  maxRetries?: number;
  /** 是否需要用户确认 */
  requiresUserConfirmation?: boolean;
}

/**
 * 构建 Skeptic 的 system prompt
 */
function buildSkepticSystemPrompt(): string {
  return `You are the Skeptic Agent, an independent validation AI.
Your role is to critically review the entire investigation and challenge weak claims.

## Your Task
1. Review all evidence in the chain
2. Challenge assumptions and weak claims
3. Verify logical consistency
4. Check for confirmation bias
5. Validate that conclusions follow from evidence

## Review Criteria
- Is the evidence sufficient to support the conclusion?
- Are there alternative explanations?
- Are there gaps in the investigation?
- Is the fix properly validated?
- Are there any logical fallacies?

## Output Format
Provide your review in the following structure:
- **Review Status**: APPROVED / REJECTED / NEEDS_CLARIFICATION
- **Critical Issues**: List any major problems found
- **Recommendations**: Suggested improvements
- **Confidence**: Your confidence in the investigation quality`;
}

/**
 * 构建 skeptic 的用户提示
 */
function buildSkepticPrompt(state: GraphState): string {
  // 收集所有相关证据
  const stageTransitions = state.evidenceChain
    .filter(e => e.eventType === 'workflow_stage_transition')
    .map(e => `- ${e.payload?.fromStage} -> ${e.payload?.toStage}`)
    .join('\n');

  const specialistBriefs = Object.entries(state.collectedBriefs)
    .map(([agentId, brief]) => `### ${agentId}\n${brief.substring(0, 1500)}`)
    .join('\n\n');

  const investigationResults = state.evidenceChain
    .filter(e => e.eventType === 'expert_investigation_complete')
    .map(e => JSON.stringify(e.payload, null, 2))
    .join('\n');

  const fixVerification = state.evidenceChain
    .filter(e => e.eventType === 'fix_verification_result')
    .map(e => JSON.stringify(e.payload, null, 2))
    .join('\n');

  return `
## Case Information
- Case ID: ${state.caseId}
- Run ID: ${state.runId}
- User Goal: ${state.userGoal}
- Fix Verified: ${state.fixVerified}

## Stage Transitions
${stageTransitions}

## Specialist Briefs
${specialistBriefs}

## Expert Investigation
${investigationResults}

## Fix Verification Results
${fixVerification}

## Task
Critically review the entire investigation. Look for:
1. Logical gaps or inconsistencies
2. Insufficient evidence for conclusions
3. Alternative explanations not considered
4. Confirmation bias
5. Unvalidated assumptions

Provide your independent assessment.`;
}

/**
 * Skeptic 节点
 * 调用 skeptic_agent 进行独立验证
 */
export async function skepticNode(
  state: GraphState,
  config: SkepticConfig = {}
): Promise<Partial<GraphState>> {
  const evidenceChain: GraphState['evidenceChain'] = [];
  const blockers: GraphState['blockers'] = [];
  const backtrackCount: GraphState['backtrackCount'] = { ...state.backtrackCount };

  // 记录进入 skeptic_ready 阶段
  evidenceChain.push(
    createStageTransitionEvidence(
      {
        sessionId: state.sessionId,
        runId: state.runId,
        currentStage: state.currentStage,
      },
      'skepti',
      'skeptic_agent'
    )
  );

  let skepticApproved = false;
  let reviewStatus = 'pending';

  try {
    // 使用 skeptic_agent 的配置
    const modelConfig = resolveAgentRuntimeConfig('skeptic_agent', 'skepti');
    const request: LLMRequest = {
      messages: [
        { role: 'system', content: buildSkepticSystemPrompt() },
        { role: 'user', content: buildSkepticPrompt(state) },
      ],
      model: modelConfig.modelId,
      maxTokens: 4096,
      temperature: 0.2, // 较低温度以获得更批判性的分析
    };

    // 调用 LLM
    const response = await llmAdapter.chat(request, modelConfig.providerId);

    const skepticResult = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

    // 解析审查结果
    const resultLower = skepticResult.toLowerCase();
    if (resultLower.includes('approved') || resultLower.includes('pass')) {
      skepticApproved = true;
      reviewStatus = 'approved';
    } else if (resultLower.includes('rejected') || resultLower.includes('fail')) {
      skepticApproved = false;
      reviewStatus = 'rejected';
    } else {
      skepticApproved = false;
      reviewStatus = 'needs_clarification';
    }

    // 记录 skeptic 审查结果证据
    evidenceChain.push({
      eventId: randomUUID(),
      eventType: 'skeptic_review_complete',
      agentId: 'skeptic_agent',
      status: skepticApproved ? 'ok' : 'warning',
      timestamp: Date.now(),
      payload: {
        skepticApproved,
        reviewStatus,
        resultLength: skepticResult.length,
        runId: state.runId,
        sessionId: state.sessionId,
      },
    });

    // 如果 skeptic 拒绝，处理 backtrack
    if (!skepticApproved && reviewStatus === 'rejected') {
      const currentRetryCount = backtrackCount['skeptic_rejected'] || 0;
      const maxRetries = config.maxRetries || 2;

      if (currentRetryCount >= maxRetries) {
        // 超过最大重试次数
        if (config.requiresUserConfirmation !== false) {
          // 需要用户确认
          blockers.push(
            createBlocker(
              BLOCKER_CODES.BLOCKED_SKEPTIC_SIGNOFF_REQUIRED.code,
              `Skeptic rejected the investigation after ${maxRetries} attempts. User confirmation required.`,
              ['skeptic_rejected']
            )
          );
        }
      } else {
        backtrackCount['skeptic_rejected'] = currentRetryCount + 1;
      }
    }

    return {
      currentStage: 'skepti',
      stageHistory: [state.currentStage],
      evidenceChain,
      blockers: [...state.blockers, ...blockers],
      backtrackCount,
      lastUpdated: nowIso(),
    };
  } catch (error) {
    // 记录错误
    evidenceChain.push({
      eventId: randomUUID(),
      eventType: 'skeptic_review_error',
      agentId: 'skeptic_agent',
      status: 'error',
      timestamp: Date.now(),
      payload: {
        error: error instanceof Error ? error.message : String(error),
        runId: state.runId,
        sessionId: state.sessionId,
      },
    });

    return {
      currentStage: 'skepti',
      stageHistory: [state.currentStage],
      evidenceChain,
      lastUpdated: nowIso(),
    };
  }
}

/**
 * Skeptic 后路由函数
 * 决定下一个节点：curator 或 backtrack 或 validation_blocked
 */
export function routeAfterSkeptic(state: GraphState): string {
  // 检查是否有阻断器
  const hasCriticalBlocker = state.blockers.some(
    b => !b.resolvedAt && b.code.startsWith('BLOCKED_')
  );

  if (hasCriticalBlocker) {
    return 'blocked';
  }

  // 检查 skeptic 审查结果
  const skepticReview = state.evidenceChain.find(
    e => e.eventType === 'skeptic_review_complete'
  );

  if (skepticReview && skepticReview.payload) {
    const payload = skepticReview.payload as { skepticApproved?: boolean; reviewStatus?: string };
    
    if (!payload.skepticApproved && payload.reviewStatus === 'rejected') {
      const retryCount = state.backtrackCount['skeptic_rejected'] || 0;
      if (retryCount < 2) {
        // Backtrack 到 fix_verification 重新验证
        return 'fix_verify';
      }
    }
  }

  // 正常流程：进入 curator
  return 'curate';
}
