/**
 * specialistDispatchNode.ts - Specialist Dispatch 阶段节点
 * 使用 Send() 或 Command() 并行分派到 Specialist
 * 根据问题类型选择需要分派的 Specialist 子集
 */

import { Send, Command } from '@langchain/langgraph';
import type { GraphState } from '../../../shared/types/workflow';
import type { AgentRole } from '../../../shared/types/agent';
import { INVESTIGATOR_AGENTS } from '../../../shared/constants/agents';
import {
  createStageTransitionEvidence,
  createDispatchEvidence,
  createInitialSpecialistState,
  nowIso,
} from './utils';

/** Specialist Dispatch 配置 */
export interface SpecialistDispatchConfig {
  /** 是否并行分派所有 specialists */
  parallelDispatch?: boolean;
  /** 根据意图选择 specialists（如果启用） */
  intentBasedSelection?: boolean;
  /** 强制分派的 specialists */
  forceDispatch?: AgentRole[];
  /** 跳过的 specialists */
  skipAgents?: AgentRole[];
}

/** 分派目标 */
export interface DispatchTarget {
  agentRole: AgentRole;
  objective: string;
}

/**
 * 根据意图选择推荐的 specialists
 * 从 intent_gate 阶段的分析结果中提取
 */
function selectSpecialistsByIntent(
  state: GraphState,
  skipAgents: AgentRole[] = []
): AgentRole[] {
  // 从证据链中查找 intent_analysis_complete 事件
  const intentEvent = state.evidenceChain.find(
    e => e.eventType === 'intent_analysis_complete'
  );

  if (intentEvent?.payload?.recommendedAgents) {
    const recommended = intentEvent.payload.recommendedAgents as AgentRole[];
    return recommended.filter(
      agent => INVESTIGATOR_AGENTS.includes(agent) && !skipAgents.includes(agent)
    );
  }

  // 默认分派所有 investigator agents
  return INVESTIGATOR_AGENTS.filter(agent => !skipAgents.includes(agent));
}

/**
 * 为 Specialist 生成任务目标
 */
function generateObjective(
  agentRole: AgentRole,
  state: GraphState
): string {
  const baseContext = `
Case ID: ${state.caseId}
Run ID: ${state.runId}
Session ID: ${state.sessionId}
User Goal: ${state.userGoal}
Capture Files: ${state.capturePaths?.join(', ') || 'N/A'}
`;

  const objectives: Record<AgentRole, string> = {
    triage_agent: `Analyze the problem and classify symptoms. Recommend investigation SOPs.

${baseContext}

Your task:
1. Classify the symptom type (rendering, performance, crash, etc.)
2. Identify potential root cause categories
3. Recommend which specialists should investigate
4. Output a triage report with confidence scores`,

    capture_repro_agent: `Verify capture quality and establish baseline.

${baseContext}

Your task:
1. Verify capture file integrity
2. Check if the issue is reproducible
3. Establish baseline metrics
4. Document capture characteristics`,

    pass_graph_pipeline_agent: `Analyze render passes and pipeline dependencies.

${baseContext}

Your task:
1. Analyze render pass structure
2. Identify pipeline dependencies
3. Check for pipeline state issues
4. Document pass-level findings`,

    pixel_forensics_agent: `Perform pixel-level evidence collection.

${baseContext}

Your task:
1. Locate first-bad event/frame
2. Analyze pixel value anomalies
3. Identify corruption patterns
4. Document visual evidence`,

    shader_ir_agent: `Analyze shader source and IR evidence.

${baseContext}

Your task:
1. Analyze shader source code
2. Check IR compilation issues
3. Identify shader-related bugs
4. Document shader findings`,

    driver_device_agent: `Perform cross-device attribution and platform checks.

${baseContext}

Your task:
1. Check driver version compatibility
2. Identify platform-specific issues
3. Analyze device capabilities
4. Document driver/device findings`,

    // 非 investigator agents 不应该被分派，但提供默认值
    skeptic_agent: `Review and challenge evidence.`,
    curator_agent: `Generate final report.`,
    'rdc-debugger': `Orchestrate workflow.`,
  };

  return objectives[agentRole] || `Investigate the problem:\n${baseContext}`;
}

/**
 * Specialist Dispatch 节点
 * 分派 specialists 并更新状态
 */
export async function specialistDispatchNode(
  state: GraphState,
  config: SpecialistDispatchConfig = {}
): Promise<Partial<GraphState>> {
  const evidenceChain: GraphState['evidenceChain'] = [];
  const activeSpecialists: GraphState['activeSpecialists'] = { ...state.activeSpecialists };
  const pendingBriefs: string[] = [...state.pendingBriefs];

  // 记录进入 specialist_dispatch 阶段
  evidenceChain.push(
    createStageTransitionEvidence(
      {
        sessionId: state.sessionId,
        runId: state.runId,
        currentStage: state.currentStage,
      },
      'waiting_for_specialist_brief'
    )
  );

  // 选择要分派的 specialists
  let selectedAgents: AgentRole[];
  if (config.forceDispatch && config.forceDispatch.length > 0) {
    selectedAgents = config.forceDispatch;
  } else if (config.intentBasedSelection !== false) {
    selectedAgents = selectSpecialistsByIntent(state, config.skipAgents);
  } else {
    selectedAgents = INVESTIGATOR_AGENTS.filter(
      agent => !config.skipAgents?.includes(agent)
    );
  }

  // 创建 dispatch 目标
  const dispatchTargets: DispatchTarget[] = selectedAgents.map(agentRole => ({
    agentRole,
    objective: generateObjective(agentRole, state),
  }));

  // 为每个 specialist 创建状态记录和 dispatch 证据
  for (const target of dispatchTargets) {
    const tokenId = crypto.randomUUID();

    // 初始化 specialist 状态
    activeSpecialists[target.agentRole] = createInitialSpecialistState(target.agentRole);
    activeSpecialists[target.agentRole].status = 'running';
    activeSpecialists[target.agentRole].startedAt = nowIso();

    // 添加到 pending briefs
    if (!pendingBriefs.includes(target.agentRole)) {
      pendingBriefs.push(target.agentRole);
    }

    // 创建 dispatch 证据
    evidenceChain.push(
      createDispatchEvidence(
        { sessionId: state.sessionId, runId: state.runId },
        target.agentRole,
        target.objective,
        tokenId
      )
    );
  }

  // 记录 dispatch 完成
  evidenceChain.push({
    eventId: crypto.randomUUID(),
    eventType: 'specialist_dispatch_complete',
    agentId: 'rdc-debugger',
    status: 'ok',
    timestamp: Date.now(),
    payload: {
      dispatchedAgents: selectedAgents,
      dispatchCount: selectedAgents.length,
      parallelMode: config.parallelDispatch !== false,
      runId: state.runId,
      sessionId: state.sessionId,
    },
  });

  return {
    currentStage: 'waiting_for_specialist_brief',
    stageHistory: [state.currentStage],
    evidenceChain,
    activeSpecialists,
    pendingBriefs,
    lastUpdated: nowIso(),
  };
}

/**
 * 创建 Send 命令数组用于并行分派
 * 这是 LangGraph 的并行分派模式
 */
export function createSpecialistSends(
  state: GraphState,
  config: SpecialistDispatchConfig = {}
): Send[] {
  // 选择要分派的 specialists
  let selectedAgents: AgentRole[];
  if (config.forceDispatch && config.forceDispatch.length > 0) {
    selectedAgents = config.forceDispatch;
  } else if (config.intentBasedSelection !== false) {
    selectedAgents = selectSpecialistsByIntent(state, config.skipAgents);
  } else {
    selectedAgents = INVESTIGATOR_AGENTS.filter(
      agent => !config.skipAgents?.includes(agent)
    );
  }

  // 创建 Send 命令数组
  return selectedAgents.map(agentRole =>
    new Send('specialist_exec', {
      agentRole,
      objective: generateObjective(agentRole, state),
      context: {
        caseId: state.caseId,
        runId: state.runId,
        sessionId: state.sessionId,
        capturePaths: state.capturePaths,
        userGoal: state.userGoal,
      },
    })
  );
}

/**
 * Specialist Dispatch 后路由函数
 * 
 * 注意：当使用 Send() 并行分派时，这个路由函数应该返回 Send 数组
 * 或者返回下一个节点名（如果不使用并行分派）
 */
export function routeAfterSpecialistDispatch(
  state: GraphState,
  config: SpecialistDispatchConfig = {}
): string | Send[] {
  // 检查是否有阻断器
  const hasCriticalBlocker = state.blockers.some(
    b => !b.resolvedAt && b.code.startsWith('BLOCKED_')
  );

  if (hasCriticalBlocker) {
    return 'validation_blocked';
  }

  // 如果使用并行分派，返回 Send 数组
  if (config.parallelDispatch !== false) {
    return createSpecialistSends(state, config);
  }

  // 否则进入 specialist_briefs 等待阶段
  return 'specialist_briefs';
}

/**
 * 创建 Command 用于 specialist 分派
 * 这是另一种并行分派模式
 */
export function createSpecialistCommand(
  state: GraphState,
  config: SpecialistDispatchConfig = {}
): Command {
  const sends = createSpecialistSends(state, config);
  return new Command({
    goto: sends,
  });
}
