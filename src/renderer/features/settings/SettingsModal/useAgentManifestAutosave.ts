import { useEffect, useMemo, useRef } from 'react';
import type { AgentManifestDraft } from '@shared/types/agentManifest';
import type { AppSettings } from '@shared/types/settings';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface UseAgentManifestAutosaveOptions {
  open: boolean;
  settings: AppSettings;
  agentManifestDrafts: AgentManifestDraft[];
  onSave: () => Promise<AppSettings | null>;
  onSaveStateChange: (state: SaveState) => void;
  onSaveMessageChange: (message: string) => void;
}

const serializeAgentManifestDefinitions = (definitions: unknown): string =>
  JSON.stringify(definitions);

export function useAgentManifestAutosave({
  open,
  settings,
  agentManifestDrafts,
  onSave,
  onSaveStateChange,
  onSaveMessageChange,
}: UseAgentManifestAutosaveOptions) {
  const savedSnapshotRef = useRef(serializeAgentManifestDefinitions(settings.agents.definitions));
  const wasOpenRef = useRef(open);
  const saveRef = useRef(onSave);
  const draftSnapshot = useMemo(
    () => serializeAgentManifestDefinitions(agentManifestDrafts),
    [agentManifestDrafts],
  );

  useEffect(() => {
    saveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    if (!open) {
      savedSnapshotRef.current = serializeAgentManifestDefinitions(settings.agents.definitions);
    }
  }, [open, settings.agents.definitions]);

  useEffect(() => {
    if (!open) return;
    if (draftSnapshot === savedSnapshotRef.current) return;

    onSaveStateChange('idle');
    onSaveMessageChange('');
    const timer = window.setTimeout(() => {
      void saveRef.current().then((nextSettings) => {
        if (nextSettings) {
          savedSnapshotRef.current = serializeAgentManifestDefinitions(nextSettings.agents.definitions);
        }
      });
    }, 600);

    return () => window.clearTimeout(timer);
  }, [draftSnapshot, onSaveMessageChange, onSaveStateChange, open]);

  useEffect(() => {
    if (wasOpenRef.current && !open && draftSnapshot !== savedSnapshotRef.current) {
      void saveRef.current().then((nextSettings) => {
        if (nextSettings) {
          savedSnapshotRef.current = serializeAgentManifestDefinitions(nextSettings.agents.definitions);
        }
      });
    }
    wasOpenRef.current = open;
  }, [draftSnapshot, open]);
}
