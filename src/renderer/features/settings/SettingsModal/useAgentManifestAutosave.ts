import { useEffect, useMemo, useRef } from 'react';
import type { AgentDefinitionSaveResult, AgentManifestDraft } from '@shared/types/agentManifest';
import type { AppSettings } from '@shared/types/settings';
import { nextAgentDefinitionClientRevision } from '../../../stores/appSettingsStore';
import {
  applyAgentDefinitionSaveResults,
  getChangedAgentManifestDrafts,
  selectSubmittableAgentManifestDrafts,
  serializeAgentManifestDraft,
  shouldRollbackFailedAgentManifestSave,
} from './agentManifestAutosaveState';
import type { AgentManifestSaveBatch } from './settingsModalActions';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface UseAgentManifestAutosaveOptions {
  open: boolean;
  settings: AppSettings;
  agentManifestDrafts: AgentManifestDraft[];
  onSave: (batch: AgentManifestSaveBatch) => Promise<AgentDefinitionSaveResult[] | null>;
  currentProjectId?: string | null;
  onRollback: (failedDrafts: AgentManifestDraft[], savedDrafts: AgentManifestDraft[]) => void;
  onSaveStateChange: (state: SaveState) => void;
  onSaveMessageChange: (message: string) => void;
  onBlockedChange?: (blocked: boolean) => void;
  blockSubmit?: (draft: AgentManifestDraft) => string | null;
  blockProjectedSubmit?: (projectedDrafts: AgentManifestDraft[]) => string | null;
  savedMessage: string;
  failedMessage: string;
}

export function useAgentManifestAutosave({
  open,
  settings,
  agentManifestDrafts,
  onSave,
  currentProjectId,
  onRollback,
  onSaveStateChange,
  onSaveMessageChange,
  onBlockedChange,
  blockSubmit,
  blockProjectedSubmit,
  savedMessage,
  failedMessage,
}: UseAgentManifestAutosaveOptions) {
  const savedDraftsRef = useRef<AgentManifestDraft[]>(settings.agents.definitions.map((entry) => ({ ...entry })));
  const latestRevisionRef = useRef(0);
  const committedRevisionRef = useRef(0);
  const wasOpenRef = useRef(open);
  const draftsRef = useRef(agentManifestDrafts);
  const failedDraftsRef = useRef<AgentManifestDraft[] | null>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const saveRef = useRef(onSave);
  const rollbackRef = useRef(onRollback);
  const stateRef = useRef(onSaveStateChange);
  const messageRef = useRef(onSaveMessageChange);
  const blockedRef = useRef(onBlockedChange);
  const blockSubmitRef = useRef(blockSubmit);
  const blockProjectedRef = useRef(blockProjectedSubmit);
  const draftSnapshot = useMemo(
    () => agentManifestDrafts.map(serializeAgentManifestDraft).join('\n'),
    [agentManifestDrafts],
  );

  useEffect(() => { draftsRef.current = agentManifestDrafts; }, [agentManifestDrafts]);
  useEffect(() => { saveRef.current = onSave; }, [onSave]);
  useEffect(() => { rollbackRef.current = onRollback; }, [onRollback]);
  useEffect(() => { stateRef.current = onSaveStateChange; }, [onSaveStateChange]);
  useEffect(() => { messageRef.current = onSaveMessageChange; }, [onSaveMessageChange]);
  useEffect(() => { blockedRef.current = onBlockedChange; }, [onBlockedChange]);
  useEffect(() => { blockSubmitRef.current = blockSubmit; }, [blockSubmit]);
  useEffect(() => { blockProjectedRef.current = blockProjectedSubmit; }, [blockProjectedSubmit]);

  useEffect(() => {
    if (!open) {
      savedDraftsRef.current = settings.agents.definitions.map((entry) => ({ ...entry }));
      failedDraftsRef.current = null;
    }
  }, [open, settings.agents.definitions]);

  const selectDrafts = (pending = getChangedAgentManifestDrafts(draftsRef.current, savedDraftsRef.current)) => (
    selectSubmittableAgentManifestDrafts(
      pending, blockSubmitRef.current, blockProjectedRef.current, draftsRef.current,
    )
  );

  const executeRef = useRef<(drafts: AgentManifestDraft[], revision: number, visibleDrafts?: AgentManifestDraft[]) => Promise<void>>(async () => {});
  executeRef.current = async (drafts, revision, visibleDrafts = drafts) => {
    blockedRef.current?.(false);
    stateRef.current('saving');
    messageRef.current('');
    try {
      const results = await saveRef.current({ drafts, clientRevision: revision });
      if (!results) throw new Error(failedMessage);
      if (revision >= committedRevisionRef.current) {
        savedDraftsRef.current = applyAgentDefinitionSaveResults(
          savedDraftsRef.current,
          drafts,
          results,
          currentProjectId,
        );
        committedRevisionRef.current = revision;
      }
      if (revision !== latestRevisionRef.current) return;
      const remaining = selectDrafts();
      if (remaining.drafts.length === 0 && remaining.blockedReason) {
        latestRevisionRef.current = nextAgentDefinitionClientRevision();
        blockedRef.current?.(true);
        stateRef.current('error');
        messageRef.current(remaining.blockedReason);
        return;
      }
      if (results.every((result) => result.status === 'committed')) {
        failedDraftsRef.current = null;
        stateRef.current('saved');
        messageRef.current(savedMessage);
      }
    } catch (error) {
      if (!shouldRollbackFailedAgentManifestSave(
        revision,
        latestRevisionRef.current,
        visibleDrafts,
        draftsRef.current,
      )) return;
      // Keep the attempted values and compare hashes even when the visible draft
      // rolls back. Retrying must not save unrelated profiles or rebase a conflict.
      failedDraftsRef.current = drafts;
      rollbackRef.current(drafts, savedDraftsRef.current);
      blockedRef.current?.(false);
      stateRef.current('error');
      messageRef.current(error instanceof Error && error.message ? error.message : failedMessage);
    }
  };

  useEffect(() => {
    if (!open) return;
    const { drafts: changed, blockedReason } = selectDrafts();
    if (changed.length === 0) {
      if (blockedReason) {
        latestRevisionRef.current = nextAgentDefinitionClientRevision();
        blockedRef.current?.(true);
        stateRef.current('error');
        messageRef.current(blockedReason);
      }
      return;
    }
    const revision = nextAgentDefinitionClientRevision();
    latestRevisionRef.current = revision;
    blockedRef.current?.(false);
    stateRef.current('idle');
    messageRef.current('');
    const timer = window.setTimeout(() => void executeRef.current(changed, revision), 300);
    debounceTimerRef.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (debounceTimerRef.current === timer) debounceTimerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draftSnapshot serializes agentManifestDrafts for deep change detection
  }, [draftSnapshot, open]);

  useEffect(() => {
    if (wasOpenRef.current && !open) {
      const { drafts: changed } = selectDrafts();
      if (changed.length > 0) {
        const revision = nextAgentDefinitionClientRevision();
        latestRevisionRef.current = revision;
        void executeRef.current(changed, revision);
      }
    }
    wasOpenRef.current = open;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draftSnapshot serializes agentManifestDrafts for deep change detection
  }, [draftSnapshot, open]);

  const retry = async () => {
    if (!open) return;
    const changed = getChangedAgentManifestDrafts(draftsRef.current, savedDraftsRef.current);
    const pending = changed.length > 0 ? changed : (failedDraftsRef.current ?? []);
    const { drafts, blockedReason } = selectDrafts(pending);
    if (blockedReason) {
      blockedRef.current?.(true);
      stateRef.current('error');
      messageRef.current(blockedReason);
      return;
    }
    if (drafts.length === 0) return;
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    const revision = nextAgentDefinitionClientRevision();
    latestRevisionRef.current = revision;
    await executeRef.current(drafts, revision, draftsRef.current.filter(current => drafts.some(draft => draft.id === current.id)));
  };

  return { retry };
}
