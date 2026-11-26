import { useEffect, useMemo, useRef, useState } from 'react';
import { RevisionLanes } from '../../../lib/revisionLanes';
import {
  applyAgentDefinitionSaveResults,
  getChangedAgentManifestDrafts,
  selectSubmittableAgentManifestDrafts,
  serializeAgentManifestDraft,
  shouldRollbackFailedAgentManifestSave,
} from './agentManifestAutosaveState';
import type {
  AgentDefinitionSaveResult,
  AgentManifestDefinition,
  AgentManifestDraft,
} from '@shared/types/agentManifest';
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

export function useAgentManifestAutosave(options: UseAgentManifestAutosaveOptions) {
  const { open, settings, agentManifestDrafts, currentProjectId, savedMessage, failedMessage } = options;
  const savedDraftsRef = useRef<AgentManifestDraft[]>(settings.agents.definitions.map((entry) => ({ ...entry })));
  // One lane for the editor's batches: only the newest drives the status; a result moves the saved baseline only
  // when it is newer than the one applied.
  const [lanes] = useState(() => new RevisionLanes());
  const wasOpenRef = useRef(open);
  const failedDraftsRef = useRef<AgentManifestDraft[] | null>(null);
  const debounceTimerRef = useRef<number | null>(null);
  // Saves and their callbacks run after renders; they read the drafts and callbacks of the latest one.
  const latest = useRef(options);
  latest.current = options;
  const draftSnapshot = useMemo(
    () => agentManifestDrafts.map(serializeAgentManifestDraft).join('\n'),
    [agentManifestDrafts],
  );
  /** Reports the save status and its message; `blocked` says whether a required field stops the save. */
  const report = (state: SaveState, message: string, blocked?: boolean) => {
    if (blocked !== undefined) latest.current.onBlockedChange?.(blocked);
    latest.current.onSaveStateChange(state);
    latest.current.onSaveMessageChange(message);
  };

  /** Committed definitions become the saved baseline: on close, and after import or migration. */
  const rebase = (definitions: AgentManifestDefinition[]) => {
    savedDraftsRef.current = definitions.map((entry) => ({ ...entry }));
    failedDraftsRef.current = null;
  };

  useEffect(() => {
    if (!open) rebase(settings.agents.definitions);
  }, [open, settings.agents.definitions]);

  const selectDrafts = (
    pending = getChangedAgentManifestDrafts(latest.current.agentManifestDrafts, savedDraftsRef.current),
  ) =>
    selectSubmittableAgentManifestDrafts(
      pending,
      latest.current.blockSubmit,
      latest.current.blockProjectedSubmit,
      latest.current.agentManifestDrafts,
    );

  const executeRef = useRef<
    (drafts: AgentManifestDraft[], revision: number, visibleDrafts?: AgentManifestDraft[]) => Promise<void>
  >(async () => {});
  executeRef.current = async (drafts, revision, visibleDrafts = drafts) => {
    report('saving', '', false);
    try {
      const results = await latest.current.onSave({ drafts });
      if (!results) throw new Error(failedMessage);
      lanes.applyIfNewer('drafts', revision, () => {
        savedDraftsRef.current = applyAgentDefinitionSaveResults(
          savedDraftsRef.current,
          drafts,
          results,
          currentProjectId,
        );
      });
      if (!lanes.isLatest('drafts', revision)) return;
      const remaining = selectDrafts();
      if (remaining.drafts.length === 0 && remaining.blockedReason) {
        lanes.begin('drafts');
        report('error', remaining.blockedReason, true);
        return;
      }
      if (results.every((result) => result.status === 'committed')) {
        failedDraftsRef.current = null;
        report('saved', savedMessage);
      }
    } catch (error) {
      if (
        !shouldRollbackFailedAgentManifestSave(
          lanes.isLatest('drafts', revision),
          visibleDrafts,
          latest.current.agentManifestDrafts,
        )
      )
        return;
      // Keep the attempted values and compare hashes even when the visible draft
      // rolls back. Retrying must not save unrelated profiles or rebase a conflict.
      failedDraftsRef.current = drafts;
      latest.current.onRollback(drafts, savedDraftsRef.current);
      report('error', error instanceof Error && error.message ? error.message : failedMessage, false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const { drafts: changed, blockedReason } = selectDrafts();
    if (changed.length === 0) {
      if (blockedReason) {
        lanes.begin('drafts');
        report('error', blockedReason, true);
      }
      return;
    }
    const revision = lanes.begin('drafts');
    report('idle', '', false);
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
    const current = latest.current.agentManifestDrafts;
    const changed = getChangedAgentManifestDrafts(current, savedDraftsRef.current);
    const pending = changed.length > 0 ? changed : (failedDraftsRef.current ?? []);
    const { drafts, blockedReason } = selectDrafts(pending);
    if (blockedReason) {
      report('error', blockedReason, true);
      return;
    }
    if (drafts.length === 0) return;
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    await executeRef.current(
      drafts,
      lanes.begin('drafts'),
      current.filter((entry) => drafts.some((draft) => draft.id === entry.id)),
    );
  };

  return { retry, rebase };
}
