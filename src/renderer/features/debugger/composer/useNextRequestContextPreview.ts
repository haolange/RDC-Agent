import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppMode } from '@shared/types/session';
import type { NextRequestContextProjection, ProjectRecord, RunSummary, SessionRecord } from '@shared/types/session';
import type { PendingAttachmentDraft } from '../../../app/bootstrap/types';
import { getElectronApi } from '../../../platform/getElectronApi';
import { useAppSettingsStore } from '../../../stores/appSettingsStore';
import { useConversationStore } from '../../../stores/conversationStore';
import { useTurnControlsStore } from './useTurnControls';

const PREVIEW_DEBOUNCE_MS = 60;

export function shouldAcceptNextRequestContextProjection(
  expectedRevision: number,
  projection: NextRequestContextProjection,
): boolean {
  return projection.clientRevision === expectedRevision;
}

export function useNextRequestContextPreview(input: {
  project: ProjectRecord | null;
  session: SessionRecord | null;
  currentRun: RunSummary | null;
  replayDeviceId: string | null;
  mode: AppMode;
  agentId: string;
  draft: string;
  attachments: PendingAttachmentDraft[];
}) {
  const [projection, setProjection] = useState<NextRequestContextProjection | null>(null);
  const [pending, setPending] = useState(false);
  const revisionRef = useRef(0);
  const turnControls = useTurnControlsStore((state) => state.turnControls);
  const capability = useTurnControlsStore((state) => state.capability);
  const settingsHydrated = useAppSettingsStore((state) => state.hydrated);
  const agentFingerprint = useAppSettingsStore((state) => {
    const route = state.settings.llm.agentRoutes.find((entry) => entry.agentId === input.agentId);
    const definition = state.settings.agents.definitions.find((entry) => entry.id === input.agentId);
    return JSON.stringify({
      route: route ? [route.providerId, route.modelId] : null,
      definition: definition ? {
        models: definition.models,
        tools: definition.tools,
        skills: definition.skills,
        mcpServers: definition.mcpServers,
        instructions: definition.instructions,
      } : null,
    });
  });
  const historyFingerprint = useConversationStore((state) => state.conversationMessages
    .filter((message) => message.status !== 'streaming' && message.status !== 'draft')
    .map((message) => `${message.id}:${message.updatedAt ?? message.createdAt}:${message.status}`)
    .join('|'));
  const attachmentsFingerprint = useMemo(
    () => input.attachments
      .map((attachment) => `${attachment.sourcePath}:${attachment.mimeType ?? ''}:${attachment.size ?? ''}`)
      .join('|'),
    [input.attachments],
  );
  const capabilityFingerprint = capability
    ? JSON.stringify([
        capability.providerId,
        capability.modelId,
        capability.route.protocol,
        capability.contextTiers,
        capability.defaultBudgetTokens,
        capability.reasoning,
        capability.fast,
      ])
    : 'pending';

  useEffect(() => {
    const electronAPI = getElectronApi();
    if (!electronAPI || !settingsHydrated || !input.agentId) {
      setProjection(null);
      setPending(false);
      return;
    }

    revisionRef.current += 1;
    const revision = revisionRef.current;
    let cancelled = false;
    setPending(true);
    const timeoutId = window.setTimeout(() => {
      void electronAPI.conversation.previewNextRequestContext({
        clientRevision: revision,
        projectId: input.project?.projectId ?? null,
        sessionId: input.session?.sessionId ?? null,
        currentRunId: input.currentRun?.runId ?? null,
        replayDeviceId: input.replayDeviceId,
        mode: input.mode,
        agentId: input.agentId,
        message: input.draft,
        attachments: input.attachments.map((attachment) => ({
          sourcePath: attachment.sourcePath,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          size: attachment.size,
        })),
        turnControls: { ...turnControls },
      }).then((nextProjection) => {
        if (
          cancelled
          || revision !== revisionRef.current
          || !shouldAcceptNextRequestContextProjection(revision, nextProjection)
        ) return;
        setProjection(nextProjection);
        setPending(false);
      }).catch(() => {
        if (cancelled || revision !== revisionRef.current) return;
        setProjection(null);
        setPending(false);
      });
    }, PREVIEW_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [
    agentFingerprint,
    attachmentsFingerprint,
    capabilityFingerprint,
    historyFingerprint,
    input.agentId,
    input.currentRun?.runId,
    input.draft,
    input.mode,
    input.project?.projectId,
    input.replayDeviceId,
    input.session?.sessionId,
    settingsHydrated,
    turnControls,
  ]);

  return { projection, pending };
}
