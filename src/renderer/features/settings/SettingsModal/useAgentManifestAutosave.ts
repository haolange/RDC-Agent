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

export {
  applyAgentDefinitionSaveResults,
  getChangedAgentManifestDrafts,
  rollbackAgentManifestDrafts,
  selectSubmittableAgentManifestDrafts,
  serializeAgentManifestDraft,
  shouldRollbackFailedAgentManifestSave,
} from './agentManifestAutosaveState';

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
    if (!open) savedDraftsRef.current = settings.agents.definitions.map((entry) => ({ ...entry }));
  }, [open, settings.agents.definitions]);

  const executeRef = useRef<(drafts: AgentManifestDraft[], revision: number) => Promise<void>>(async () => {});
  executeRef.current = async (drafts, revision) => {
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
      const remaining = selectSubmittableAgentManifestDrafts(
        getChangedAgentManifestDrafts(draftsRef.current, savedDraftsRef.current),
        blockSubmitRef.current,
        blockProjectedRef.current,
        draftsRef.current,
      );
      if (remaining.drafts.length === 0 && remaining.blockedReason) {
        latestRevisionRef.current = nextAgentDefinitionClientRevision();
        blockedRef.current?.(true);
        stateRef.current('error');
        messageRef.current(remaining.blockedReason);
        return;
      }
      if (results.every((result) => result.status === 'committed')) {
        stateRef.current('saved');
        messageRef.current(savedMessage);
      }
    } catch (error) {
      if (!shouldRollbackFailedAgentManifestSave(
        revision,
        latestRevisionRef.current,
        drafts,
        draftsRef.current,
      )) return;
      rollbackRef.current(drafts, savedDraftsRef.current);
      blockedRef.current?.(false);
      stateRef.current('error');
      messageRef.current(error instanceof Error && error.message ? error.message : failedMessage);
    }
  };

  useEffect(() => {
    if (!open) return;
    const { drafts: changed, blockedReason } = selectSubmittableAgentManifestDrafts(
      getChangedAgentManifestDrafts(agentManifestDrafts, savedDraftsRef.current),
      blockSubmitRef.current,
      blockProjectedRef.current,
      agentManifestDrafts,
    );
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
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draftSnapshot serializes agentManifestDrafts for deep change detection
  }, [draftSnapshot, open]);

  useEffect(() => {
    if (wasOpenRef.current && !open) {
      const { drafts: changed } = selectSubmittableAgentManifestDrafts(
        getChangedAgentManifestDrafts(agentManifestDrafts, savedDraftsRef.current),
        blockSubmitRef.current,
        blockProjectedRef.current,
        agentManifestDrafts,
      );
      if (changed.length > 0) {
        const revision = nextAgentDefinitionClientRevision();
        latestRevisionRef.current = revision;
        void executeRef.current(changed, revision);
      }
    }
    wasOpenRef.current = open;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draftSnapshot serializes agentManifestDrafts for deep change detection
  }, [draftSnapshot, open]);
}
