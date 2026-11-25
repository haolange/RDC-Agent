import { useEffect, useMemo, useRef, useState } from 'react';
import { RevisionLanes } from '../../../lib/revisionLanes';
import {
  applyAgentDefinitionSaveResults,
  getChangedAgentManifestDrafts,
  selectSubmittableAgentManifestDrafts,
  serializeAgentManifestDraft,
  shouldRollbackFailedAgentManifestSave,
} from './agentManifestAutosaveState';
import type { AgentDefinitionSaveResult, AgentManifestDefinition, AgentManifestDraft } from '@shared/types/agentManifest';
import type { AppSettings } from '@shared/types/settings';
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
  // One lane for the editor's batches: only the newest drives the status; a result moves the saved baseline only
  // when it is newer than the one applied.
  const [lanes] = useState(() => new RevisionLanes());
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

  /** Committed definitions become the saved baseline: on close, and after import or migration. */
  const rebase = (definitions: AgentManifestDefinition[]) => {
    savedDraftsRef.current = definitions.map((entry) => ({ ...entry }));
    failedDraftsRef.current = null;
  };

  useEffect(() => {
    if (!open) rebase(settings.agents.definitions);
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
      const results = await saveRef.current({ drafts });
      if (!results) throw new Error(failedMessage);
      lanes.applyIfNewer('drafts', revision, () => {
        savedDraftsRef.current = applyAgentDefinitionSaveResults(savedDraftsRef.current, drafts, results, currentProjectId);
      });
      if (!lanes.isLatest('drafts', revision)) return;
      const remaining = selectDrafts();
      if (remaining.drafts.length === 0 && remaining.blockedReason) {
        lanes.begin('drafts');
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
      if (!shouldRollbackFailedAgentManifestSave(lanes.isLatest('drafts', revision), visibleDrafts, draftsRef.current)) return;
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
        lanes.begin('drafts');
        blockedRef.current?.(true);
        stateRef.current('error');
        messageRef.current(blockedReason);
      }
      return;
    }
    const revision = lanes.begin('drafts');
    blockedRef.current?.(false);
    stateRef.current('idle');
    messageRef.current('');
    const timer = window.setTimeout(() => void executeRef.current(changed, revision), 300);
    debounceTimerRef.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (debounceTimerRef.current === timer) debounceTimerRef.current = null;
    };

  }, [draftSnapshot, lanes, open]);

  useEffect(() => {
    if (wasOpenRef.current && !open) {
      const { drafts: changed } = selectDrafts();
      if (changed.length > 0) void executeRef.current(changed, lanes.begin('drafts'));
    }
    wasOpenRef.current = open;

  }, [draftSnapshot, lanes, open]);

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
    await executeRef.current(drafts, lanes.begin('drafts'), draftsRef.current.filter(current => drafts.some(draft => draft.id === current.id)));
  };

  return { retry, rebase };
}
