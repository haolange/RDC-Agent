import type { AgentProfile } from '@shared/types/agenticTrace';

export const debuggerAgentProfile: AgentProfile = {
  agentType: 'debugger',
  displayName: 'Debugger Agent',
  description: 'RenderDoc capture debugging agent',
  version: '1.0.0',
  phases: [
    { phaseId: 'understand', displayName: '理解任务' },
    { phaseId: 'plan', displayName: '制定计划' },
    { phaseId: 'search', displayName: '搜索定位' },
    { phaseId: 'inspect', displayName: '检查分析' },
    { phaseId: 'modify', displayName: '修改验证' },
    { phaseId: 'execute', displayName: '执行工具' },
    { phaseId: 'verify', displayName: '验证结果' },
    { phaseId: 'summarize', displayName: '总结报告' },
  ],
  tools: [],
  ui: {
    defaultLayout: 'timeline',
    showPlanByDefault: true,
    showThoughtSummaryByDefault: true,
    showRawToolName: false,
    defaultCollapseLevel: 'summary',
  },
};

export const askAgentProfile: AgentProfile = {
  agentType: 'ask',
  displayName: 'Ask Agent',
  version: '1.0.0',
  phases: [
    { phaseId: 'understand', displayName: '理解问题' },
    { phaseId: 'summarize', displayName: '回答总结' },
  ],
  tools: [],
  ui: {
    defaultLayout: 'timeline',
    showPlanByDefault: false,
    showThoughtSummaryByDefault: true,
    showRawToolName: false,
    defaultCollapseLevel: 'summary',
  },
};
