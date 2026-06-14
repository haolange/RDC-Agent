import type { AgentProfile } from '@shared/types/agenticTrace';
import type { AppMode } from '@shared/types/session';
import { TRACE_AGENT_PROFILES, createTraceAgentProfile } from './profileManifest';

export class AgentProfileRegistry {
  private profiles = new Map<string, AgentProfile>(TRACE_AGENT_PROFILES);

  get(agentType: string): AgentProfile {
    return this.profiles.get(agentType) ?? createTraceAgentProfile('debugger');
  }

  getForMode(mode: AppMode): AgentProfile {
    return this.get(mode);
  }
}

export const agentProfileRegistry = new AgentProfileRegistry();
