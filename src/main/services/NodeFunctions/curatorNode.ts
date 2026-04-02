/**
 * curatorNode.ts - Curator 报告生成阶段节点
 * 调用 curator_agent 生成最终报告，汇总全部证据链
 */

import type { GraphState, Report } from '../../../shared/types/workflow';
import type { LLMRequest } from '../../../shared/types/llm';
import { llmAdapter } from '../../adapters/LLMAdapter';
import { DEFAULT_MODEL_ROUTING } from '../../../shared/constants/agents';
import {
  createStageTransitionEvidence,
  createArtifact,
  nowIso,
} from './utils';

/** Curator 节点配置 */
export interface CuratorConfig {
  /** 报告格式 */
  reportFormat?: 'markdown' | 'json' | 'structured';
  /** 是否包含详细证据 */
  includeDetailedEvidence?: boolean;
}

/**
 * 构建 Curator 的 system prompt
 */
function buildCuratorSystemPrompt(): string {
  return `You are the Curator Agent, responsible for generating the final investigation report.
Your role is to synthesize all evidence into a clear, actionable report.

## Your Task
1. Review all evidence from the investigation
2. Summarize findings in a structured format
3. Document the root cause clearly
4. Provide actionable fix instructions
5. Include confidence assessment

## Report Structure
Generate a report with the following sections:
- **Title**: Concise problem description
- **Summary**: Executive summary of the issue
- **Root Cause**: Clear explanation of what caused the problem
- **Fix Description**: Step-by-step fix instructions
- **Evidence Summary**: Key evidence supporting the conclusion
- **Recommendations**: Additional suggestions
- **Confidence**: Overall confidence level (0-1)

## Output Format
Return the report as a JSON object matching the Report type structure.`;
}

/**
 * 构建 curator 的用户提示
 */
function buildCuratorPrompt(state: GraphState): string {
  // 收集所有证据
  const allEvidence = state.evidenceChain
    .map(e => `[${e.eventType}] ${e.agentId}: ${JSON.stringify(e.payload).substring(0, 500)}`)
    .join('\n');

  const specialistBriefs = Object.entries(state.collectedBriefs)
    .map(([agentId, brief]) => `### ${agentId}\n${brief.substring(0, 2000)}`)
    .join('\n\n');

  const artifacts = state.artifacts
    .map(a => `- ${a.type}: ${a.path} (by ${a.agentId})`)
    .join('\n');

  const investigationResults = state.evidenceChain
    .filter(e => e.eventType === 'expert_investigation_complete')
    .map(e => JSON.stringify(e.payload, null, 2))
    .join('\n');

  const fixVerification = state.evidenceChain
    .filter(e => e.eventType === 'fix_verification_result')
    .map(e => JSON.stringify(e.payload, null, 2))
    .join('\n');

  const skepticReview = state.evidenceChain
    .filter(e => e.eventType === 'skeptic_review_complete')
    .map(e => JSON.stringify(e.payload, null, 2))
    .join('\n');

  return `
## Case Information
- Case ID: ${state.caseId}
- Run ID: ${state.runId}
- Session ID: ${state.sessionId}
- User Goal: ${state.userGoal}
- Fix Verified: ${state.fixVerified}

## All Evidence
${allEvidence}

## Specialist Briefs
${specialistBriefs}

## Artifacts Generated
${artifacts || 'No artifacts'}

## Expert Investigation
${investigationResults}

## Fix Verification
${fixVerification}

## Skeptic Review
${skepticReview}

## Task
Generate a comprehensive final report based on all the evidence above.
Structure your response as a valid JSON object with these fields:
{
  "title": "string",
  "summary": "string",
  "rootCause": "string",
  "fixDescription": "string",
  "evidenceSummary": ["string"],
  "recommendations": ["string"],
  "confidence": number (0-1),
  "generatedAt": "ISO timestamp",
  "curatorAgentId": "curator_agent"
}`;
}

/**
 * 解析 LLM 响应为 Report 对象
 */
function parseReportFromResponse(content: string): Report {
  try {
    // 尝试提取 JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        title: parsed.title || 'Investigation Report',
        summary: parsed.summary || 'No summary provided',
        rootCause: parsed.rootCause || 'Root cause not determined',
        fixDescription: parsed.fixDescription || 'No fix provided',
        evidenceSummary: Array.isArray(parsed.evidenceSummary) ? parsed.evidenceSummary : [],
        recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
        generatedAt: nowIso(),
        curatorAgentId: 'curator_agent',
      };
    }
  } catch {
    // JSON 解析失败，使用文本内容
  }

  // 返回默认报告结构
  return {
    title: 'Investigation Report',
    summary: content.substring(0, 500),
    rootCause: 'See summary for details',
    fixDescription: 'See summary for details',
    evidenceSummary: [],
    recommendations: [],
    confidence: 0.5,
    generatedAt: nowIso(),
    curatorAgentId: 'curator_agent',
  };
}

/**
 * Curator 节点
 * 生成最终报告
 */
export async function curatorNode(
  state: GraphState,
  _config: CuratorConfig = {}
): Promise<Partial<GraphState>> {
  const evidenceChain: GraphState['evidenceChain'] = [];
  const artifacts: GraphState['artifacts'] = [];

  // 记录进入 curator_ready 阶段
  evidenceChain.push(
    createStageTransitionEvidence(
      {
        sessionId: state.sessionId,
        runId: state.runId,
        currentStage: state.currentStage,
      },
      'curator_ready',
      'curator_agent'
    )
  );

  try {
    // 使用 curator_agent 的配置
    const modelConfig = DEFAULT_MODEL_ROUTING['curator_agent'];
    const request: LLMRequest = {
      messages: [
        { role: 'system', content: buildCuratorSystemPrompt() },
        { role: 'user', content: buildCuratorPrompt(state) },
      ],
      model: modelConfig.model,
      maxTokens: 4096,
      temperature: 0.3,
    };

    // 调用 LLM
    const response = await llmAdapter.chat(request, modelConfig.provider);

    const reportContent = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

    // 解析报告
    const finalReport = parseReportFromResponse(reportContent);

    // 创建报告 artifact
    const reportArtifact = createArtifact(
      'final_report',
      `reports/${state.runId}_final_report.json`,
      'curator_agent'
    );
    artifacts.push(reportArtifact);

    // 记录报告生成证据
    evidenceChain.push({
      eventId: crypto.randomUUID(),
      eventType: 'curator_report_generated',
      agentId: 'curator_agent',
      status: 'ok',
      timestamp: Date.now(),
      payload: {
        reportTitle: finalReport.title,
        confidence: finalReport.confidence,
        evidenceCount: finalReport.evidenceSummary.length,
        recommendationCount: finalReport.recommendations.length,
        runId: state.runId,
        sessionId: state.sessionId,
      },
    });

    return {
      currentStage: 'curator_ready',
      stageHistory: [state.currentStage],
      evidenceChain,
      artifacts: [...state.artifacts, ...artifacts],
      finalReport,
      lastUpdated: nowIso(),
    };
  } catch (error) {
    // 记录错误
    evidenceChain.push({
      eventId: crypto.randomUUID(),
      eventType: 'curator_report_error',
      agentId: 'curator_agent',
      status: 'error',
      timestamp: Date.now(),
      payload: {
        error: error instanceof Error ? error.message : String(error),
        runId: state.runId,
        sessionId: state.sessionId,
      },
    });

    // 返回一个基本的错误报告
    const errorReport: Report = {
      title: 'Error Generating Report',
      summary: `Failed to generate report: ${error instanceof Error ? error.message : String(error)}`,
      rootCause: 'Report generation failed',
      fixDescription: 'Please retry or check system logs',
      evidenceSummary: [],
      recommendations: ['Retry report generation'],
      confidence: 0,
      generatedAt: nowIso(),
      curatorAgentId: 'curator_agent',
    };

    return {
      currentStage: 'curator_ready',
      stageHistory: [state.currentStage],
      evidenceChain,
      finalReport: errorReport,
      lastUpdated: nowIso(),
    };
  }
}

/**
 * Curator 后路由函数
 * 决定下一个节点：finalize 或 validation_blocked
 */
export function routeAfterCurator(state: GraphState): string {
  // 检查是否有阻断器
  const hasCriticalBlocker = state.blockers.some(
    b => !b.resolvedAt && b.code.startsWith('BLOCKED_')
  );

  if (hasCriticalBlocker) {
    return 'validation_blocked';
  }

  // 检查是否有最终报告
  if (!state.finalReport) {
    // 报告生成失败，可能需要重试
    return 'curator';
  }

  // 正常流程：进入 finalize
  return 'finalize';
}
