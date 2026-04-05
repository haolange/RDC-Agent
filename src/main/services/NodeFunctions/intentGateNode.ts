/**
 * intentGateNode.ts - Intent Gate 阶段节点
 * 解析 userGoal，分类问题类型，通过 LLM 分析用户意图
 */

import { randomUUID } from 'crypto';
import type { GraphState } from '../../../shared/types/workflow';
import type { AgentRole } from '../../../shared/types/agent';
import { llmAdapter } from '../../adapters/LLMAdapter';
import { BLOCKER_CODES } from '../../../shared/constants/blockers';
import {
  createStageTransitionEvidence,
  createBlocker,
  createToolExecutionEvidence,
  nowIso,
  resolveAgentRuntimeConfig,
} from './utils';

/** 意图分析结果 */
export interface IntentAnalysisResult {
  /** 问题类别 */
  category: 'rendering' | 'performance' | 'crash' | 'artifact' | 'shader' | 'unknown';
  /** 严重程度 */
  severity: 'critical' | 'high' | 'medium' | 'low';
  /** 涉及子系统 */
  subsystems: string[];
  /** 推荐的 Specialist Agents */
  recommendedAgents: AgentRole[];
  /** 置信度 0-1 */
  confidence: number;
  /** 分析摘要 */
  summary: string;
  /** 关键词 */
  keywords: string[];
}

/** Intent Gate 配置 */
export interface IntentGateConfig {
  /** 最小置信度阈值 */
  minConfidence?: number;
  /** 使用的模型 */
  modelProvider?: string;
  modelName?: string;
}

/**
 * 分析用户意图
 */
async function analyzeIntent(
  userGoal: string,
  config: IntentGateConfig
): Promise<IntentAnalysisResult> {
  const systemPrompt = `You are an expert graphics debugging assistant. Analyze the user's problem description and classify it into categories.

Output a JSON object with the following structure:
{
  "category": "rendering|performance|crash|artifact|shader|unknown",
  "severity": "critical|high|medium|low",
  "subsystems": ["list", "of", "affected", "subsystems"],
  "recommendedAgents": ["agent_role_1", "agent_role_2"],
  "confidence": 0.0-1.0,
  "summary": "Brief analysis summary",
  "keywords": ["key", "words"]
}

Available agent roles:
- triage_agent: Symptom classification and SOP recommendation
- capture_repro_agent: Capture quality verification and baseline establishment
- pass_graph_pipeline_agent: Render pass and pipeline dependency analysis
- pixel_forensics_agent: Pixel-level evidence collection and first-bad event localization
- shader_ir_agent: Shader source and IR evidence analysis
- driver_device_agent: Cross-device attribution and platform-specific checks

Rules:
1. category must be one of the allowed values
2. severity should reflect business impact
3. recommendedAgents should be relevant to the problem type
4. confidence should reflect how well the intent is understood
5. Be concise but informative`;

  const response = await llmAdapter.chat(
    {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Analyze this problem description:\n\n${userGoal}` },
      ],
      model: config.modelName || 'anthropic/claude-3-sonnet',
      maxTokens: 2048,
      temperature: 0.3,
    },
    config.modelProvider || 'openrouter'
  );

  const content = typeof response.content === 'string'
    ? response.content
    : JSON.stringify(response.content);

  try {
    // 尝试从响应中提取 JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as IntentAnalysisResult;
    }
    throw new Error('No JSON found in response');
  } catch {
    // 返回默认结果
    return {
      category: 'unknown',
      severity: 'medium',
      subsystems: [],
      recommendedAgents: ['triage_agent'],
      confidence: 0.5,
      summary: 'Failed to parse intent analysis',
      keywords: [],
    };
  }
}

/**
 * Intent Gate 节点
 * 解析 userGoal，分类问题类型
 */
export async function intentGateNode(
  state: GraphState,
  config: IntentGateConfig = {}
): Promise<Partial<GraphState>> {
  const evidenceChain: GraphState['evidenceChain'] = [];
  const blockers: GraphState['blockers'] = [];

  // 记录进入 plan 阶段
  evidenceChain.push(
    createStageTransitionEvidence(
      {
        sessionId: state.sessionId,
        runId: state.runId,
        currentStage: state.currentStage,
      },
      'plan'
    )
  );

  // 检查是否有 userGoal
  if (!state.userGoal || state.userGoal.trim().length === 0) {
    blockers.push(
      createBlocker(
        BLOCKER_CODES.BLOCKED_INTAKE_GATE_REQUIRED.code,
        'User goal is required for intent analysis',
        ['userGoal']
      )
    );

    return {
      currentStage: 'plan',
      stageHistory: [state.currentStage],
      evidenceChain,
      blockers: [...state.blockers, ...blockers],
      lastUpdated: nowIso(),
    };
  }

  try {
    // 分析用户意图
    const runtimeConfig = resolveAgentRuntimeConfig('rdc-debugger', 'plan');
    const analysisResult = await analyzeIntent(state.userGoal, {
      ...config,
      modelProvider: runtimeConfig.providerId,
      modelName: runtimeConfig.modelId,
    });

    // 检查置信度
    const minConfidence = config.minConfidence ?? 0.3;
    if (analysisResult.confidence < minConfidence) {
      blockers.push(
        createBlocker(
          BLOCKER_CODES.BLOCKED_INTAKE_GATE_REQUIRED.code,
          `Intent analysis confidence (${analysisResult.confidence}) below threshold (${minConfidence}). Please provide more details.`,
          ['userGoal', 'confidence']
        )
      );
    }

    // 记录工具执行证据
    evidenceChain.push(
      createToolExecutionEvidence(
        { sessionId: state.sessionId, runId: state.runId },
        'intent_analysis',
        { userGoal: state.userGoal },
        { ok: true, data: analysisResult },
        'rdc-debugger'
      )
    );

    // 记录分析结果
    evidenceChain.push({
      eventId: randomUUID(),
      eventType: 'intent_analysis_complete',
      agentId: 'rdc-debugger',
      status: blockers.length === 0 ? 'ok' : 'blocked',
      timestamp: Date.now(),
      payload: {
        category: analysisResult.category,
        severity: analysisResult.severity,
        recommendedAgents: analysisResult.recommendedAgents,
        confidence: analysisResult.confidence,
        summary: analysisResult.summary,
        keywords: analysisResult.keywords,
        runId: state.runId,
        sessionId: state.sessionId,
      },
    });

    return {
      currentStage: 'plan',
      stageHistory: [state.currentStage],
      evidenceChain,
      blockers: [...state.blockers, ...blockers],
      lastUpdated: nowIso(),
    };
  } catch (error) {
    // 记录错误
    evidenceChain.push(
      createToolExecutionEvidence(
        { sessionId: state.sessionId, runId: state.runId },
        'intent_analysis',
        { userGoal: state.userGoal },
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        'rdc-debugger'
      )
    );

    // 添加阻断器但不阻塞流程（降级处理）
    console.warn('[intentGate] Analysis failed, continuing with default routing:', error);

    return {
      currentStage: 'plan',
      stageHistory: [state.currentStage],
      evidenceChain,
      lastUpdated: nowIso(),
    };
  }
}

/**
 * Intent Gate 后路由函数
 */
export function routeAfterIntentGate(state: GraphState): string {
  // 检查是否有阻断器
  const hasCriticalBlocker = state.blockers.some(
    b => !b.resolvedAt && b.code.startsWith('BLOCKED_')
  );

  if (hasCriticalBlocker) {
    return 'blocked';
  }

  // 正常流程：进入 speclist
  return 'speclist';
}
