import { DEFAULT_AGENT_ID } from '@shared/types/agent';
import type { AgentProfile } from '@shared/types/agenticTrace';
import { TRACE_AGENT_PROFILES, createTraceAgentProfile } from './profileManifest';

export class AgentProfileRegistry {
  private profiles = new Map<string, AgentProfile>(TRACE_AGENT_PROFILES);

  get(agentType: string): AgentProfile {
    const id = agentType.trim();
    if (!id) {
      return this.profiles.get(DEFAULT_AGENT_ID) ?? createTraceAgentProfile(DEFAULT_AGENT_ID);
    }
    return this.profiles.get(id) ?? createTraceAgentProfile(id);
  }

  getForMode(profileId: string): AgentProfile {
    return this.get(profileId);
  }
}

export const agentProfileRegistry = new AgentProfileRegistry();
