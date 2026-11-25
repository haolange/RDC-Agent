import { DEFAULT_AGENT_ID } from '@shared/types/agent';
import { conversationTurnIds } from '@shared/conversation/conversationTurnIds';
import type { ConversationAttachmentInput, ConversationMessage } from '@shared/types/conversation';
import type { ProjectRecord, RunSummary, SessionRecord } from '@shared/types/session';
import type { PendingAttachmentDraft } from '../types/attachments';

export const resolveComposerProfileId = (selectedAgentId?: string): string =>
  selectedAgentId?.trim() || DEFAULT_AGENT_ID;

/**
 * The user and assistant messages a send shows before main answers. They carry the ids main gives them
 * (`conversationTurnIds`), so main's messages update them in place.
 */
export function buildOptimisticConversationTurn(options: {
  requestId: string;
  trimmed: string;
  currentProject: ProjectRecord | null;
  currentSession: SessionRecord | null;
  currentRun: RunSummary | null;
  pendingAttachments: PendingAttachmentDraft[];
  selectedAgentId?: string;
  /** Shown at once, so a plan handoff never flashes its raw prompt while main verifies the claim. */
  planReference?: ConversationMessage['planReference'];
}): { userMessage: ConversationMessage; assistantDraftMessage: ConversationMessage } {
  const {
    requestId,
    trimmed,
    currentProject,
    currentSession,
    currentRun,
    pendingAttachments,
    selectedAgentId,
    planReference,
  } = options;
  const { turnId, userMessageId: userId, assistantMessageId: assistantId } = conversationTurnIds(requestId);
  const now = Date.now();
  const profileId = resolveComposerProfileId(selectedAgentId);

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
    ...(planReference ? { planReference } : {}),
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
    agentId: profileId,
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

  return { userMessage, assistantDraftMessage };
}

/** The messages without those of `requestId`: a request main refused, or Stop revoked while it prepared. */
export const removeRequestMessages = (
  messages: ConversationMessage[],
  requestId: string,
): ConversationMessage[] => {
  const kept = messages.filter((message) => message.requestId !== requestId);
  return kept.length === messages.length ? messages : kept;
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
    material: attachment.material,
  }));
