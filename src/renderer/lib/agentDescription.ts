import type { AgentManifestDefinition } from '@shared/types/agentManifest';
import type { Translator, TranslationKey } from '../i18n/messages';
const DESCRIPTION_KEYS: Record<string, TranslationKey> = {
  general: 'settings.agentDescription.general', debugger: 'settings.agentDescription.debugger',
  analyzer: 'settings.agentDescription.analyzer', optimizer: 'settings.agentDescription.optimizer',
};
/** Only shipped builtin metadata is product copy; user/project overrides remain original content. */
export function agentDescription(agent: AgentManifestDefinition | undefined, t: Translator): string {
  if (!agent) return '';
  const key = agent.provenance?.scope === 'builtin' ? DESCRIPTION_KEYS[agent.id] : undefined;
  return key ? t(key) : agent.description;
}
