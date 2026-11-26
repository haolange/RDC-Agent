import { resolveManifestText } from '@shared/utils/handoffLabels';
import type { AgentManifestDefinition } from '@shared/types/agentManifest';
import type { AppLanguage } from '@shared/types/settings';

type AgentCopy = Pick<
  AgentManifestDefinition,
  'description' | 'descriptionTranslations' | 'argumentHint' | 'argumentHintTranslations'
>;

/** A shipped Agent's description in the interface language; user and project copies keep their own text. */
export function agentDescription(agent: AgentCopy | undefined, language: AppLanguage): string {
  return agent ? resolveManifestText(agent.description, agent.descriptionTranslations, language) : '';
}

/** What to tell this Agent, in the interface language when the shipped manifest translates it. */
export function agentArgumentHint(agent: AgentCopy | undefined, language: AppLanguage): string {
  return agent ? resolveManifestText(agent.argumentHint, agent.argumentHintTranslations, language) : '';
}
