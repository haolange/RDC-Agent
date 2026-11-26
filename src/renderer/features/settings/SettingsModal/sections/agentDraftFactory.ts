import { agentDescription } from '../../../../lib/agentDescription';
import { uniqueResourceId } from './uniqueResourceId';
import type { AgentManifestDraft } from '@shared/types/agentManifest';
import type { AppSettings } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';

type Translate = ReturnType<typeof useI18n>['t'];
export type AgentScope = 'user' | 'project';

export const visibleDrafts = (drafts: AgentManifestDraft[]): AgentManifestDraft[] =>
  drafts.filter((draft) => !draft.delete);

export const toSlug = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'agent';

/** Read-only scope filter: `writeScope` mirrors the definition provenance (builtin drafts write to user). */
export const draftScope = (draft: AgentManifestDraft): AgentScope =>
  draft.writeScope === 'project' ? 'project' : 'user';

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
    writeProjectId: scope === 'project' ? (currentProjectId ?? undefined) : undefined,
  };
};

/** A copy of an Agent under the next free `<id>-copy` id and `<name> Copy` name, based on nothing. */
export const duplicateDraft = (agent: AgentManifestDraft, existing: AgentManifestDraft[]): AgentManifestDraft => {
  const id = uniqueResourceId(
    `${toSlug(agent.id)}-copy`,
    existing.map((entry) => entry.id),
  );
  return {
    ...agent,
    id,
    fileName: `${id}.agent.md`,
    name: uniqueResourceId(
      `${agent.name} Copy`,
      existing.map((entry) => entry.name),
    ),
    basedOn: undefined,
  };
};

/** A shipped description is shown in the interface language until the user edits it. */
export const draftDescription = (
  agent: AgentManifestDraft,
  settings: Pick<AppSettings, 'agents' | 'appearance'>,
): string => {
  const definition = settings.agents.definitions.find((entry) => entry.id === agent.id);
  return definition && definition.description === agent.description
    ? agentDescription(definition, settings.appearance.language)
    : agent.description;
};
