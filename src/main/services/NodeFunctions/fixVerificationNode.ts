/**
 * fixVerificationNode.ts - Fix Verification 阶段节点
 * 验证修复方案的有效性，调用相关工具确认修复
 */

import type { GraphState } from '../../../shared/types/workflow';
import type { LLMRequest } from '../../../shared/types/llm';
import { llmAdapter } from '../../adapters/LLMAdapter';
import { DEFAULT_MODEL_ROUTING } from '../../../shared/constants/agents';
import {
  createStageTransitionEvidence,
  createBlocker,
  nowIso,
} from './utils';
import { BLOCKER_CODES } from '../../../shared/constants/blockers';

/** Fix Verification 节点配置 */
export interface FixVerificationConfig {
  /** 是否启用自动验证 */
  enableAutoVerification?: boolean;
  /** 验证超时时间（秒） */
  verificationTimeout?: number;
  /** 最大重试次数 */
  maxRetries?: number;
}

/**
 * 构建 Fix Verification 的 system prompt
 */
function buildVerificationSystemPrompt(): string {
  return `You are the RDC Debugger Fix Verification system.
Your role is to verify that the proposed fix will actually resolve the issue.

## Your Task
1. Review the expert investigation findings
2. Analyze the proposed fix steps
3. Verify fix feasibility and completeness
4. Identify any risks or side effects
5. Confirm or reject the fix with reasoning

## Verification Criteria
- Does the fix address the root cause?
- Are the fix steps actionable?
- Are there any potential side effects?
- Is the fix validated by the evidence chain?

## Output Format
Provide your verification result:
- **Verification Status**: VERIFIED / REJECTED / NEEDS_MORE_INFO
- **Reasoning**: Detailed explanation
- **Confidence**: High/Medium/Low
- **Recommendations**: Any additional steps needed`;
}

/**
 * 构建 verification 的用户提示
 */
function buildVerificationPrompt(state: GraphState): string {
  // 从 evidence payload 提取实际的 expert investigation 文本（而非仅元数据）
  const investigationEvidence = state.evidenceChain
    .filter(e => e.eventType === 'expert_investigation_complete')
    .map(e => {
      const p = e.payload as Record<string, unknown>;
      const summary = p.investigationSummary as string | undefined;
      // 优先使用存储的完整分析文本，降级为 JSON 元数据
      return summary || JSON.stringify(p);
    })
    .join('\n');

  // 增大截断限制：briefs 从 1000 → 2000（验证阶段需要足够信息做判断）
  const briefsSummary = Object.entries(state.collectedBriefs)
    .map(([agentId, brief]) => `### ${agentId}\n${brief.substring(0, 2000)}`)
    .join('\n\n');

  // 注入 prior Skeptic critique（如果有）
  const priorSkepticCritiques = state.backtrackCritiques?.['skeptic'] || [];
  const critiqueSection = priorSkepticCritiques.length > 0
    ? `\n## Prior Skeptic Rejection Reasons\nA previous attempt at this fix was rejected by the Skeptic for the following reasons. Your fix MUST explicitly address each point:\n${priorSkepticCritiques.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n`
    : '';

  return `
## Case Information
- Case ID: ${state.caseId}
- Run ID: ${state.runId}
- User Goal: ${state.userGoal}
${critiqueSection}
## Specialist Briefs Summary
${briefsSummary}

## Expert Investigation Results
${investigationEvidence}

## Task
Verify the proposed fix based on the evidence above. Determine if:
1. The root cause is correctly identified
2. The fix addresses the root cause
3. The fix is practical and actionable
4. Any additional verification is needed`;
}

/**
 * Fix Verification 节点
 * 验证修复方案的有效性
 */
export async function fixVerificationNode(
  state: GraphState,
  config: FixVerificationConfig = {}
): Promise<Partial<GraphState>> {
  const evidenceChain: GraphState['evidenceChain'] = [];
  const blockers: GraphState['blockers'] = [];
  const backtrackCount: GraphState['backtrackCount'] = { ...state.backtrackCount };

  // 记录进入 fix_verification_complete 阶段
  evidenceChain.push(
    createStageTransitionEvidence(
      {
        sessionId: state.sessionId,
        runId: state.runId,
        currentStage: state.currentStage,
      },
      'fix_verification_complete'
    )
  );

  let fixVerified = false;
  let verificationStatus = 'pending';
  const backtrackCritiques: GraphState['backtrackCritiques'] = {};

  try {
    // 构建 LLM 请求进行验证分析
    const modelConfig = DEFAULT_MODEL_ROUTING['rdc-debugger'];
    const request: LLMRequest = {
      messages: [
        { role: 'system', content: buildVerificationSystemPrompt() },
        { role: 'user', content: buildVerificationPrompt(state) },
      ],
      model: modelConfig.model,
      maxTokens: 2048,
      temperature: 0.2,
    };

    // 调用 LLM
    const response = await llmAdapter.chat(request, modelConfig.provider);

    const verificationResult = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

    // 解析验证结果（简化判断）
    const resultLower = verificationResult.toLowerCase();
    if (resultLower.includes('verified') || resultLower.includes('approved')) {
      fixVerified = true;
      verificationStatus = 'verified';
    } else if (resultLower.includes('rejected') || resultLower.includes('failed')) {
      fixVerified = false;
      verificationStatus = 'rejected';
    } else {
      fixVerified = false;
      verificationStatus = 'needs_review';
    }

    // 记录验证结果证据
    evidenceChain.push({
      eventId: crypto.randomUUID(),
      eventType: 'fix_verification_result',
      agentId: 'rdc-debugger',
      status: fixVerified ? 'ok' : 'warning',
      timestamp: Date.now(),
      payload: {
        fixVerified,
        verificationStatus,
        resultLength: verificationResult.length,
        runId: state.runId,
        sessionId: state.sessionId,
      },
    });

    // 如果验证失败且需要 backtrack
    if (!fixVerified && verificationStatus === 'rejected') {
      const currentRetryCount = backtrackCount['fix_verification'] || 0;
      const maxRetries = config.maxRetries || 2;

      // 存储拒绝原因到 backtrackCritiques，供 expertInvestigation 下一轮注入
      backtrackCritiques['fix_verification'] = [verificationResult.substring(0, 800)];

      if (currentRetryCount >= maxRetries) {
        // 超过最大重试次数，创建 blocker
        blockers.push(
          createBlocker(
            BLOCKER_CODES.BLOCKED_VALIDATION_FAILED.code,
            `Fix verification failed after ${maxRetries} attempts`,
            ['fix_verification']
          )
        );
      } else {
        backtrackCount['fix_verification'] = currentRetryCount + 1;
      }
    }

    return {
      currentStage: 'fix_verification_complete',
      stageHistory: [state.currentStage],
      evidenceChain,
      blockers: [...state.blockers, ...blockers],
      fixVerified,
      backtrackCount,
      backtrackCritiques,
      lastUpdated: nowIso(),
    };
  } catch (error) {
    // 记录错误
    evidenceChain.push({
      eventId: crypto.randomUUID(),
      eventType: 'fix_verification_error',
      agentId: 'rdc-debugger',
      status: 'error',
      timestamp: Date.now(),
      payload: {
        error: error instanceof Error ? error.message : String(error),
        runId: state.runId,
        sessionId: state.sessionId,
      },
    });

    return {
      currentStage: 'fix_verification_complete',
      stageHistory: [state.currentStage],
      evidenceChain,
      fixVerified: false,
      lastUpdated: nowIso(),
    };
  }
}

/**
 * Fix Verification 后路由函数
 * 决定下一个节点：skeptic 或 backtrack 或 validation_blocked
 */
export function routeAfterFixVerification(state: GraphState): string {
  // 检查是否有阻断器
  const hasCriticalBlocker = state.blockers.some(
    b => !b.resolvedAt && b.code.startsWith('BLOCKED_')
  );

  if (hasCriticalBlocker) {
    return 'validation_blocked';
  }

  // 如果验证失败，检查是否需要 backtrack
  if (!state.fixVerified) {
    const retryCount = state.backtrackCount['fix_verification'] || 0;
    if (retryCount < 2) {
      // Backtrack 到 expert_investigation 重新分析
      return 'expert_investigation';
    }
  }

  // 正常流程：进入 skeptic 验证
  return 'skeptic';
}
