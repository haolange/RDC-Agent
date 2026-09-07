import type { ConversationAttachmentInput, ConversationMessage } from '@shared/types/conversation';
import type { AgentMode } from '@shared/types/layout';
import type { ProjectRecord, RunSummary, SessionRecord } from '@shared/types/session';
import type { PendingAttachmentDraft } from '../types/attachments';

export const resolveComposerProfileId = (_mode: AgentMode, selectedAgentId?: string): string =>
  selectedAgentId?.trim() || 'general';

export function buildOptimisticConversationTurn(options: {
  requestId: string;
  trimmed: string;
  currentMode: AgentMode;
  currentProject: ProjectRecord | null;
  currentSession: SessionRecord | null;
  currentRun: RunSummary | null;
  pendingAttachments: PendingAttachmentDraft[];
  selectedAgentId?: string;
}): { userMessage: ConversationMessage; assistantDraftMessage: ConversationMessage; optimisticIds: string[] } {
  const {
    requestId,
    trimmed,
    currentMode,
    currentProject,
    currentSession,
    currentRun,
    pendingAttachments,
    selectedAgentId,
  } = options;
  const turnId = `optimistic-turn-${requestId}`;
  const now = Date.now();
  const profileId = resolveComposerProfileId(currentMode, selectedAgentId);
  const userId = `optimistic-user-${requestId}`;
  const assistantId = `optimistic-assistant-${requestId}`;

  const userMessage: ConversationMessage = {
    id: userId,
    requestId,
    turnId,
    sessionId: currentSession?.sessionId ?? null,
    projectId: currentProject?.projectId ?? null,
    runId: currentRun?.runId ?? null,
    profileId,
    role: 'user',
    content: trimmed,
    status: 'complete',
    updatedAt: now,
    workTrace: null,
    attachments: pendingAttachments.map((attachment) => ({
      attachmentId: `optimistic-${attachment.id}`,
      sessionId: currentSession?.sessionId ?? '',
      projectId: currentProject?.projectId ?? '',
      kind: attachment.kind,
      layer: attachment.layer,
      fileName: attachment.fileName,
      filePath: attachment.sourcePath,
      mimeType: attachment.mimeType || 'application/octet-stream',
      size: attachment.size || 0,
      createdAt: now,
    })),
    createdAt: now,
  };

  const assistantDraftMessage: ConversationMessage = {
    id: assistantId,
    requestId,
    turnId,
    sessionId: currentSession?.sessionId ?? null,
    projectId: currentProject?.projectId ?? null,
    runId: currentRun?.runId ?? null,
    profileId,
    role: 'assistant',
    agentId: selectedAgentId || currentMode,
    content: '',
    status: 'streaming',
    updatedAt: now,
    workTrace: {
      status: 'running',
      summary: '',
      blocks: [],
      updatedAt: now,
    },
    createdAt: now,
  };

  return {
    userMessage,
    assistantDraftMessage,
    optimisticIds: [userId, assistantId],
  };
}

export const removeOptimisticConversationMessages = (
  messages: ConversationMessage[],
  optimisticIds: string[],
): ConversationMessage[] => {
  if (optimisticIds.length === 0) return messages;
  const idSet = new Set(optimisticIds);
  return messages.filter((message) => !idSet.has(message.id));
};

export const toConversationAttachmentInputs = (
  pendingAttachments: PendingAttachmentDraft[],
): ConversationAttachmentInput[] => pendingAttachments
  .filter((attachment) => !attachment.error && attachment.sourcePath)
  .map((attachment) => ({
    sourcePath: attachment.sourcePath,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    size: attachment.size,
    stagingId: attachment.stagingId,
  }));
