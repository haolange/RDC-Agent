import { useEffect, useMemo, useRef } from 'react';
import type { AgentDefinitionSaveResult, AgentManifestDraft } from '@shared/types/agentManifest';
import type { AppSettings } from '@shared/types/settings';
import { nextAgentDefinitionClientRevision } from '../../../stores/appSettingsStore';
import type { AgentManifestSaveBatch } from './settingsModalActions';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface UseAgentManifestAutosaveOptions {
  open: boolean;
  settings: AppSettings;
  agentManifestDrafts: AgentManifestDraft[];
  onSave: (batch: AgentManifestSaveBatch) => Promise<AgentDefinitionSaveResult[] | null>;
  onRollback: (failedDrafts: AgentManifestDraft[], savedDrafts: AgentManifestDraft[]) => void;
  onSaveStateChange: (state: SaveState) => void;
  onSaveMessageChange: (message: string) => void;
  savedMessage: string;
  failedMessage: string;
}

export const serializeAgentManifestDraft = (draft: AgentManifestDraft): string => JSON.stringify({
  id: draft.id,
  fileName: draft.fileName,
  name: draft.name,
  description: draft.description,
  argumentHint: draft.argumentHint,
  target: draft.target,
  models: draft.models,
  icon: draft.icon,
  accent: draft.accent,
  disableModelInvocation: draft.disableModelInvocation,
  userInvocable: draft.userInvocable,
  tools: draft.tools,
  skills: draft.skills,
  mcpServers: draft.mcpServers,
  agents: draft.agents,
  handoffs: draft.handoffs,
  metadata: draft.metadata,
  instructions: draft.instructions,
  enabled: draft.enabled,
  maxTurns: draft.maxTurns,
  delete: Boolean(draft.delete),
});

export const getChangedAgentManifestDrafts = (
  current: AgentManifestDraft[],
  saved: AgentManifestDraft[],
): AgentManifestDraft[] => {
  const savedById = new Map(saved.map((draft) => [draft.id, serializeAgentManifestDraft(draft)]));
  return current.filter((draft) => serializeAgentManifestDraft(draft) !== savedById.get(draft.id));
};

export const rollbackAgentManifestDrafts = (
  current: AgentManifestDraft[],
  failed: AgentManifestDraft[],
  saved: AgentManifestDraft[],
): AgentManifestDraft[] => {
  const failedIds = new Set(failed.map((draft) => draft.id));
  const savedById = new Map(saved.map((draft) => [draft.id, draft]));
  const restored = current.flatMap((draft) => {
    if (!failedIds.has(draft.id)) return [draft];
    const previous = savedById.get(draft.id);
    return previous ? [{ ...previous }] : [];
  });
  for (const draft of failed) {
    const previous = savedById.get(draft.id);
    if (previous && !restored.some((entry) => entry.id === draft.id)) restored.push({ ...previous });
  }
  return restored;
};

const commitSavedDrafts = (
  saved: AgentManifestDraft[],
  committed: AgentManifestDraft[],
): AgentManifestDraft[] => {
  const next = [...saved];
  for (const draft of committed) {
    const index = next.findIndex((entry) => entry.id === draft.id);
    if (draft.delete) {
      if (index >= 0) next.splice(index, 1);
      continue;
    }
    const { delete: _delete, ...cleanDraft } = draft;
    if (index >= 0) next[index] = cleanDraft as AgentManifestDraft;
    else next.push(cleanDraft as AgentManifestDraft);
  }
  return next;
};

export function useAgentManifestAutosave({
  open,
  settings,
  agentManifestDrafts,
  onSave,
  onRollback,
  onSaveStateChange,
  onSaveMessageChange,
  savedMessage,
  failedMessage,
}: UseAgentManifestAutosaveOptions) {
  const savedDraftsRef = useRef<AgentManifestDraft[]>(settings.agents.definitions.map((entry) => ({ ...entry })));
  const latestRevisionRef = useRef(0);
  const committedRevisionRef = useRef(0);
  const wasOpenRef = useRef(open);
  const saveRef = useRef(onSave);
  const rollbackRef = useRef(onRollback);
  const stateRef = useRef(onSaveStateChange);
  const messageRef = useRef(onSaveMessageChange);
  const draftSnapshot = useMemo(
    () => agentManifestDrafts.map(serializeAgentManifestDraft).join('\n'),
    [agentManifestDrafts],
  );

  useEffect(() => { saveRef.current = onSave; }, [onSave]);
  useEffect(() => { rollbackRef.current = onRollback; }, [onRollback]);
  useEffect(() => { stateRef.current = onSaveStateChange; }, [onSaveStateChange]);
  useEffect(() => { messageRef.current = onSaveMessageChange; }, [onSaveMessageChange]);

  useEffect(() => {
    if (!open) savedDraftsRef.current = settings.agents.definitions.map((entry) => ({ ...entry }));
  }, [open, settings.agents.definitions]);

  const executeRef = useRef<(drafts: AgentManifestDraft[], revision: number) => Promise<void>>(async () => {});
  executeRef.current = async (drafts, revision) => {
    stateRef.current('saving');
    messageRef.current('');
    try {
      const results = await saveRef.current({ drafts, clientRevision: revision });
      if (!results) throw new Error(failedMessage);
      const committedDrafts = drafts.filter((_, index) => results[index]?.status === 'committed');
      if (revision >= committedRevisionRef.current) {
        savedDraftsRef.current = commitSavedDrafts(savedDraftsRef.current, committedDrafts);
        committedRevisionRef.current = revision;
      }
      if (revision === latestRevisionRef.current && results.every((result) => result.status === 'committed')) {
        stateRef.current('saved');
        messageRef.current(savedMessage);
      }
    } catch (error) {
      if (revision !== latestRevisionRef.current) return;
      rollbackRef.current(drafts, savedDraftsRef.current);
      stateRef.current('error');
      messageRef.current(error instanceof Error && error.message ? error.message : failedMessage);
    }
  };

  useEffect(() => {
    if (!open) return;
    const changed = getChangedAgentManifestDrafts(agentManifestDrafts, savedDraftsRef.current);
    if (changed.length === 0) return;
    const revision = nextAgentDefinitionClientRevision();
    latestRevisionRef.current = revision;
    stateRef.current('idle');
    messageRef.current('');
    const timer = window.setTimeout(() => void executeRef.current(changed, revision), 300);
    return () => window.clearTimeout(timer);
  }, [draftSnapshot, open]);

  useEffect(() => {
    if (wasOpenRef.current && !open) {
      const changed = getChangedAgentManifestDrafts(agentManifestDrafts, savedDraftsRef.current);
      if (changed.length > 0) {
        const revision = nextAgentDefinitionClientRevision();
        latestRevisionRef.current = revision;
        void executeRef.current(changed, revision);
      }
    }
    wasOpenRef.current = open;
  }, [draftSnapshot, open]);
}
