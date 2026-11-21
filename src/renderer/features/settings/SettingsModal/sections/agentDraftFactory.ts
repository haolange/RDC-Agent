import type { AgentManifestDraft } from '@shared/types/agentManifest';
import type { useI18n } from '../../../../i18n';

type Translate = ReturnType<typeof useI18n>['t'];
export type AgentScope = 'user' | 'project';

export const visibleDrafts = (drafts: AgentManifestDraft[]): AgentManifestDraft[] =>
  drafts.filter((draft) => !draft.delete);

export const toSlug = (value: string): string =>
  value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'agent';

/** Read-only scope filter: `writeScope` mirrors the definition provenance (builtin drafts write to user). */
export const draftScope = (draft: AgentManifestDraft): AgentScope => (draft.writeScope === 'project' ? 'project' : 'user');

/** A named Agent draft; the caller has already chosen a unique id for it. */
export const createNewAgent = (
  identity: { name: string; id: string },
  t: Translate,
  scope: AgentScope,
  currentProjectId: string | null,
): AgentManifestDraft => {
  const { id, name } = identity;
  return {
    id,
    fileName: `${id}.agent.md`,
    name,
    description: t('settings.agentDefaultDescription'),
    argumentHint: t('settings.agentDefaultArgumentHint'),
    target: 'rdc-agent',
    icon: 'spark',
    accent: '#33d1ff',
    disableModelInvocation: false,
    userInvocable: false,
    tools: [],
    skills: [],
    mcpServers: [],
    agents: [],
    handoffs: [],
    metadata: {},
    instructions: t('settings.agentDefaultInstructions'),
    enabled: true,
    writeScope: scope,
    writeProjectId: scope === 'project' ? currentProjectId ?? undefined : undefined,
  };
};
