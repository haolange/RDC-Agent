import type { AgentModelOption } from '@shared/types/agentManifest';

export interface AgentModelProviderGroup {
  providerId: string;
  label: string;
  options: AgentModelOption[];
  availableCount: number;
}

export const isAgentModelSelectionInvalid = (
  value: string,
  options: AgentModelOption[],
): boolean => Boolean(value && !options.some((option) => option.canonicalId === value && option.configured));

export const agentModelOptionAccessibleLabel = (
  option: AgentModelOption,
  unavailableLabel: string,
): string => [
  option.modelLabel,
  option.canonicalId,
  ...(!option.configured ? [option.disabledReason ?? unavailableLabel] : []),
].join(' · ');

export function matchesAgentModelQuery(option: AgentModelOption, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [option.modelLabel, option.modelId, option.canonicalId, option.providerLabel]
    .some((field) => field.toLowerCase().includes(needle));
}

/** Only executable options enter the selector; Provider retains catalog diagnostics. */
export function buildAgentModelGroups(
  options: AgentModelOption[],
  query: string,
): AgentModelProviderGroup[] {
  const map = new Map<string, AgentModelOption[]>();
  for (const option of options) {
    if (!option.configured || !matchesAgentModelQuery(option, query)) continue;
    const current = map.get(option.providerId) ?? [];
    current.push(option);
    map.set(option.providerId, current);
  }
  return Array.from(map.entries()).map(([providerId, providerOptions]) => ({
    providerId,
    label: providerOptions[0]?.providerLabel || providerId,
    options: providerOptions,
    availableCount: providerOptions.filter((option) => option.configured).length,
  }));
}
