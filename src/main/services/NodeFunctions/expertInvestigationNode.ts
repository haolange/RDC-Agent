/**
 * expertInvestigationNode.ts - Expert Investigation 阶段节点
 * 基于收集到的 briefs，由 rdc-debugger 进行深入分析和诊断
 */

import { randomUUID } from 'crypto';
import type { GraphState } from '../../../shared/types/workflow';
import type { LLMRequest } from '../../../shared/types/llm';
import { llmAdapter } from '../../adapters/LLMAdapter';
import {
  createStageTransitionEvidence,
  createToolExecutionEvidence,
  createArtifact,
  ensureRunActive,
  nowIso,
  resolveAgentRuntimeConfig,
} from './utils';
import { runExecutionService } from '../RunExecutionService';

/** Expert Investigation 节点配置 */
export interface ExpertInvestigationConfig {
  /** 是否使用工具验证假设 */
  enableToolVerification?: boolean;
  /** 最大迭代次数 */
  maxIterations?: number;
}

/**
 * 构建 Expert Investigation 的 system prompt
 */
function buildExpertSystemPrompt(): string {
  return `You are the RDC Debugger, an expert graphics debugging AI assistant.
Your role is to analyze specialist briefs and form a comprehensive diagnosis.

## Your Task
1. Review all specialist briefs and identify patterns
2. Correlate findings across different analysis domains
3. Form a hypothesis about the root cause
4. Propose specific fixes or workarounds
5. Identify any gaps in the investigation that need further verification

## Output Format
Provide your analysis in the following structure:
- **Summary**: Brief overview of the issue
- **Root Cause Analysis**: Your diagnosis based on evidence
- **Proposed Fix**: Specific steps to resolve the issue
- **Confidence Level**: High/Medium/Low with reasoning
- **Verification Needed**: Any additional checks recommended`;
}

/**
 * 构建 investigation 的用户提示
 */
function buildInvestigationPrompt(state: GraphState): string {
  const briefsSummary = Object.entries(state.collectedBriefs)
    .map(([agentId, brief]) => `### ${agentId}\n${brief.substring(0, 2000)}`)
    .join('\n\n');

  const artifactsSummary = state.artifacts
    .map(a => `- ${a.type}: ${a.path}`)
    .join('\n');

  return `
## Case Information
- Case ID: ${state.caseId}
- Run ID: ${state.runId}
- User Goal: ${state.userGoal}
- Capture Files: ${state.capturePaths?.join(', ') || 'N/A'}

## Specialist Briefs
${briefsSummary}

## Artifacts
${artifactsSummary || 'No artifacts generated'}

## Task
Analyze the above briefs and provide your expert diagnosis. Focus on:
1. Identifying the most likely root cause
2. Proposing concrete fix steps
3. Highlighting any conflicting evidence
4. Suggesting verification steps`;
}

/**
 * Expert Investigation 节点
 * 调用 LLM 综合所有 specialist briefs，形成初步诊断
 */
export async function expertInvestigationNode(
  state: GraphState,
  config: ExpertInvestigationConfig = {}
): Promise<Partial<GraphState>> {
  ensureRunActive(state.runId);
  const evidenceChain: GraphState['evidenceChain'] = [];
  const artifacts: GraphState['artifacts'] = [];

  // 记录进入 expert_investigation_complete 阶段
  evidenceChain.push(
    createStageTransitionEvidence(
      {
        sessionId: state.sessionId,
        runId: state.runId,
        currentStage: state.currentStage,
      },
      'investigate'
    )
  );

  try {
    // 构建 LLM 请求
    const modelConfig = resolveAgentRuntimeConfig('rdc-debugger', 'investigate');
    const request: LLMRequest = {
      messages: [
        { role: 'system', content: buildExpertSystemPrompt() },
        { role: 'user', content: buildInvestigationPrompt(state) },
      ],
      model: modelConfig.modelId,
      maxTokens: 4096,
      temperature: 0.3, // 较低温度以获得更确定的分析
      signal: runExecutionService.getAbortSignal(state.runId) ?? undefined,
    };

    // 调用 LLM
    const response = await llmAdapter.chat(request, modelConfig.providerId);
    ensureRunActive(state.runId);

    const investigationResult = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

    // 记录 LLM 调用证据
    evidenceChain.push({
      eventId: randomUUID(),
      eventType: 'expert_investigation_complete',
      agentId: 'rdc-debugger',
      status: 'ok',
      timestamp: Date.now(),
      payload: {
        model: modelConfig.modelId,
        provider: modelConfig.providerId,
        briefsAnalyzed: Object.keys(state.collectedBriefs).length,
        resultLength: investigationResult.length,
        runId: state.runId,
        sessionId: state.sessionId,
      },
    });

    // 创建 investigation artifact
    const investigationArtifact = createArtifact(
      'expert_investigation',
      `investigation/${state.runId}_expert_analysis.md`,
      'rdc-debugger'
    );
    artifacts.push(investigationArtifact);

    // 如果需要工具验证，记录工具调用证据（简化实现）
    if (config.enableToolVerification && response.toolCalls) {
      for (const toolCall of response.toolCalls) {
        evidenceChain.push(
          createToolExecutionEvidence(
            { sessionId: state.sessionId, runId: state.runId },
            toolCall.name,
            toolCall.arguments,
            { ok: true, data: 'Tool execution simulated' },
            'rdc-debugger'
          )
        );
      }
    }

    return {
      currentStage: 'investigate',
      stageHistory: [state.currentStage],
      evidenceChain,
      artifacts: [...state.artifacts, ...artifacts],
      lastUpdated: nowIso(),
    };
  } catch (error) {
    // 记录错误
    evidenceChain.push({
      eventId: randomUUID(),
      eventType: 'expert_investigation_error',
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
      currentStage: 'investigate',
      stageHistory: [state.currentStage],
      evidenceChain,
      lastUpdated: nowIso(),
    };
  }
}

/**
 * Expert Investigation 后路由函数
 * 决定下一个节点：fix_verification 或 validation_blocked
 */
export function routeAfterExpertInvestigation(state: GraphState): string {
  // 检查是否有阻断器
  const hasCriticalBlocker = state.blockers.some(
    b => !b.resolvedAt && b.code.startsWith('BLOCKED_')
  );

  if (hasCriticalBlocker) {
    return 'blocked';
  }

  // 检查是否有足够的证据进入修复验证
  const hasInvestigationEvidence = state.evidenceChain.some(
    e => e.eventType === 'expert_investigation_complete' && e.status === 'ok'
  );

  if (!hasInvestigationEvidence) {
    // 调查失败，可能需要 backtrack 或阻断
    const retryCount = state.backtrackCount['expert_investigation'] || 0;
    if (retryCount < 2) {
      // 可以重试
      return 'investigate';
    }
  }

  // 正常流程：进入 fix_verification
  return 'fix_verify';
}
