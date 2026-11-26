import { REASONING_SELECTIONS, type ReasoningSelection } from '@shared/types/modelCapability';
import { splitCanonicalAgentModelId } from '@shared/utils/agentModelRoute';
import { isSafeAgentProfileId } from '../agent-manifests/agentProfileId';
import type { AgentModelBinding, AgentModelSettings } from '@shared/types/settings';

function sanitizeBinding(raw: unknown): AgentModelBinding {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const value = raw as Record<string, unknown>;
  const binding: AgentModelBinding = {};
  if (typeof value.model === 'string' && splitCanonicalAgentModelId(value.model)) binding.model = value.model.trim();
  if (REASONING_SELECTIONS.includes(value.reasoningLevel as ReasoningSelection)) binding.reasoningLevel = value.reasoningLevel as ReasoningSelection;
  return binding;
}

/** Persisted Agent model settings; entries that cannot be interpreted are dropped. */
export function sanitizeAgentModelSettings(raw: unknown): AgentModelSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { default: {}, byAgent: {} };
  const value = raw as Record<string, unknown>;
  const byAgent: Record<string, AgentModelBinding> = {};
  const entries = value.byAgent && typeof value.byAgent === 'object' && !Array.isArray(value.byAgent)
    ? Object.entries(value.byAgent as Record<string, unknown>) : [];
  for (const [agentId, binding] of entries) {
    if (!isSafeAgentProfileId(agentId)) continue;
    const sanitized = sanitizeBinding(binding);
    if (sanitized.model || sanitized.reasoningLevel) byAgent[agentId] = sanitized;
  }
  return { default: sanitizeBinding(value.default), byAgent };
}
