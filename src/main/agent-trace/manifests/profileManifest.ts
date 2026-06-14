import { AGENT_DESCRIPTIONS, AGENT_DISPLAY_NAMES, AGENT_ROLES } from '@shared/constants/agents';
import type { AgentId } from '@shared/types/agent';
import type { AgentProfile } from '@shared/types/agenticTrace';

const BASELINE_PHASES: AgentProfile['phases'] = [
  { phaseId: 'understand', displayName: '理解任务' },
  { phaseId: 'work', displayName: '执行工作' },
  { phaseId: 'summarize', displayName: '总结结果' },
];

const PLAN_PHASES: AgentProfile['phases'] = [
  { phaseId: 'understand', displayName: '理解目标' },
  { phaseId: 'research', displayName: '研究约束' },
  { phaseId: 'handoff', displayName: '准备交接' },
];

export const createTraceAgentProfile = (agentId: AgentId): AgentProfile => ({
  agentType: agentId,
  displayName: AGENT_DISPLAY_NAMES[agentId],
  description: AGENT_DESCRIPTIONS[agentId],
  version: '1.0.0',
  phases: agentId === 'plan' ? PLAN_PHASES : BASELINE_PHASES,
  tools: [],
  ui: {
    defaultLayout: 'timeline',
    showPlanByDefault: agentId === 'plan',
    showThoughtSummaryByDefault: false,
    showRawToolName: false,
    defaultCollapseLevel: 'summary',
  },
});

export const TRACE_AGENT_PROFILES: Array<[AgentId, AgentProfile]> = AGENT_ROLES.map((agentId) => [
  agentId,
  createTraceAgentProfile(agentId),
]);
