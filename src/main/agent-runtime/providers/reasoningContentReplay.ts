import type { RequestPlan } from '@shared/types/providerCapability';

/**
 * Contract-driven Chat Completions replay: when tools are present and the
 * route requires reasoning-content preservation across assistant turns,
 * every outbound assistant message must carry `reasoning_content` (empty
 * string if no replayable artifact). Driven by toolLoop fields, not provider names.
 */
export function requiresAssistantReasoningContent(
  requestPlan: RequestPlan | undefined,
  hasTools: boolean,
): boolean {
  if (!requestPlan || !hasTools) return false;
  const { artifactPolicy, artifactScope } = requestPlan.contracts.toolLoop;
  if (artifactPolicy !== 'preserve-reasoning-content') return false;
  return artifactScope === 'all-assistant-turns'
    || artifactScope === 'tool-call-turn'
    || artifactScope === 'provider-managed';
}
