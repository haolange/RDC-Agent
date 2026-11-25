import { AGENT_ACCESS_CEILINGS } from '@shared/types/agentManifest';
import type { AgentAccessCeiling } from '@shared/types/agentManifest';

/** The stricter of two ceilings; a delegated or overriding profile never gains access. */
export function narrowerAccessCeiling(left: AgentAccessCeiling, right: AgentAccessCeiling): AgentAccessCeiling {
  return AGENT_ACCESS_CEILINGS.indexOf(left) <= AGENT_ACCESS_CEILINGS.indexOf(right) ? left : right;
}
