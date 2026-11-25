import { REASONING_SELECTIONS, type ReasoningSelection } from '@shared/types/modelCapability';
import { splitCanonicalAgentModelId } from '@shared/utils/agentModelRoute';
import { isSafeAgentProfileId } from '../agent-manifests/agentProfileId';
import type { AgentModelBinding, AgentModelSettings } from '@shared/types/settings';

function sanitizeBinding(raw: unknown, fixes: string[], label: string): AgentModelBinding {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const value = raw as Record<string, unknown>;
  const binding: AgentModelBinding = {};
  if (typeof value.model === 'string' && splitCanonicalAgentModelId(value.model)) binding.model = value.model.trim();
  else if (value.model !== undefined) fixes.push(`Removed invalid model for ${label}`);
  if (REASONING_SELECTIONS.includes(value.reasoningLevel as ReasoningSelection)) binding.reasoningLevel = value.reasoningLevel as ReasoningSelection;
  else if (value.reasoningLevel !== undefined) fixes.push(`Removed invalid reasoning level for ${label}`);
  return binding;
}

/** Persisted Agent model settings; entries that cannot be interpreted are dropped and reported. */
export function sanitizeAgentModelSettings(raw: unknown, fixes: string[] = []): AgentModelSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { default: {}, byAgent: {} };
  const value = raw as Record<string, unknown>;
  const byAgent: Record<string, AgentModelBinding> = {};
  const entries = value.byAgent && typeof value.byAgent === 'object' && !Array.isArray(value.byAgent)
    ? Object.entries(value.byAgent as Record<string, unknown>) : [];
  for (const [agentId, binding] of entries) {
    if (!isSafeAgentProfileId(agentId)) { fixes.push(`Removed model setting for invalid Agent id ${agentId}`); continue; }
    const sanitized = sanitizeBinding(binding, fixes, agentId);
    if (sanitized.model || sanitized.reasoningLevel) byAgent[agentId] = sanitized;
  }
  return { default: sanitizeBinding(value.default, fixes, 'default'), byAgent };
}
