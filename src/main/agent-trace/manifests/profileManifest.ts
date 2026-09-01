import { AGENT_DESCRIPTIONS, AGENT_DISPLAY_NAMES, AGENT_ROLES } from '@shared/constants/agents';
import { DEFAULT_AGENT_ID, isTopLevelAgentId, type AgentId } from '@shared/types/agent';
import type { AgentProfile } from '@shared/types/agenticTrace';

const BASELINE_PHASES: AgentProfile['phases'] = [
  { phaseId: 'understand', displayName: '理解任务' },
  { phaseId: 'work', displayName: '执行工作' },
  { phaseId: 'summarize', displayName: '总结结果' },
];

const TRACE_PROFILE_UI: NonNullable<AgentProfile['ui']> = {
  defaultLayout: 'timeline',
  showPlanByDefault: false,
  showThoughtSummaryByDefault: false,
  showRawToolName: false,
  defaultCollapseLevel: 'summary',
};

export const createTraceAgentProfile = (profileId: string): AgentProfile => {
  const id = profileId.trim() || DEFAULT_AGENT_ID;
  if (isTopLevelAgentId(id)) {
    return {
      agentType: id,
      displayName: AGENT_DISPLAY_NAMES[id],
      description: AGENT_DESCRIPTIONS[id],
      version: '1.0.0',
      phases: BASELINE_PHASES,
      tools: [],
      ui: TRACE_PROFILE_UI,
    };
  }
  return {
    agentType: id,
    displayName: id,
    description: `Custom agent profile ${id}.`,
    version: '1.0.0',
    phases: BASELINE_PHASES,
    tools: [],
    ui: TRACE_PROFILE_UI,
  };
};

export const TRACE_AGENT_PROFILES: Array<[AgentId, AgentProfile]> = AGENT_ROLES.map((agentId) => [
  agentId,
  createTraceAgentProfile(agentId),
]);
