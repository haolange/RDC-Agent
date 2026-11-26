import { resolveHandoffLabel } from '@shared/utils/handoffLabels';
import { agentAccessCeiling, type AgentManifestDraft } from '@shared/types/agentManifest';
import type { AppSettings } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';

export type AgentPanel = 'identity' | 'permissions' | 'handoffs' | 'instructions';

export function agentPanelSummary(
  panel: AgentPanel,
  selectedAgent: AgentManifestDraft,
  settings: AppSettings,
  t: ReturnType<typeof useI18n>['t'],
): string | undefined {
  if (panel === 'permissions') {
    const ceiling = agentAccessCeiling(selectedAgent);
    if (ceiling === 'read-only') return t('settings.agentAccessCeilingReadOnly');
    if (ceiling === 'workspace-write') return t('settings.agentAccessCeilingWorkspaceWrite');
    return undefined;
  }
  if (panel === 'handoffs') {
    const [handoff] = selectedAgent.handoffs;
    if (!handoff) return undefined;
    if (selectedAgent.handoffs.length > 1)
      return t('settings.agentHandoffChoices', { count: selectedAgent.handoffs.length });
    const target = settings.agents.definitions.find((agent) => agent.id === handoff.agent);
    return t('settings.agentHandoffSummary', {
      label: resolveHandoffLabel(handoff, settings.appearance.language) || t('settings.handoffs'),
      target: target?.name ?? t('settings.agentHandoffTargetUnset'),
    });
  }
  if (panel === 'instructions' && !selectedAgent.instructions.trim()) return t('settings.agentInstructionsEmpty');
  return undefined;
}
