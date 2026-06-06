import type { AgentProfile } from '@shared/types/agenticTrace';
import type { AppMode } from '@shared/types/session';
import { askAgentProfile, debuggerAgentProfile } from './debuggerProfile';

export class AgentProfileRegistry {
  private profiles = new Map<string, AgentProfile>([
    ['ask', askAgentProfile],
    ['debugger', debuggerAgentProfile],
    ['analyzer', { ...debuggerAgentProfile, agentType: 'analyzer', displayName: 'Analyzer Agent' }],
    ['optimizer', { ...debuggerAgentProfile, agentType: 'optimizer', displayName: 'Optimizer Agent' }],
  ]);

  get(agentType: string): AgentProfile {
    return this.profiles.get(agentType) ?? debuggerAgentProfile;
  }

  getForMode(mode: AppMode): AgentProfile {
    return this.get(mode);
  }
}

export const agentProfileRegistry = new AgentProfileRegistry();
