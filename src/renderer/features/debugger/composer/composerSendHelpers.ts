import type { AgentMode } from '@shared/types/layout';
import type { ConversationMessage } from '@shared/types/conversation';
import type { ProjectRecord, RunSummary, SessionRecord } from '@shared/types/session';
import type { PendingAttachmentDraft } from '../../../app/bootstrap/types';

export function buildLocalConversationErrorTurn(options: {
  trimmed: string;
  currentMode: AgentMode;
  currentProject: ProjectRecord | null;
  currentSession: SessionRecord | null;
  currentRun: RunSummary | null;
  pendingAttachments: PendingAttachmentDraft[];
  errorMessage: string;
  failedSummary: string;
}): ConversationMessage[] {
  const {
    trimmed,
    currentMode,
    currentProject,
    currentSession,
    currentRun,
    pendingAttachments,
    errorMessage,
    failedSummary,
  } = options;
  const turnId = `local-turn-${Date.now()}`;
  const now = Date.now();

  return [
    {
      id: `local-user-${now}`,
      turnId,
      sessionId: currentSession?.sessionId ?? null,
      projectId: currentProject?.projectId ?? null,
      runId: currentRun?.runId ?? null,
      modeContext: currentMode,
      role: 'user',
      content: trimmed,
      status: 'complete',
      updatedAt: now,
      reasoningTrace: null,
      attachments: pendingAttachments.map((attachment) => ({
        attachmentId: `local-${attachment.id}`,
        sessionId: currentSession?.sessionId ?? '',
        projectId: currentProject?.projectId ?? '',
        kind: attachment.kind,
        fileName: attachment.fileName,
        filePath: attachment.sourcePath,
        mimeType: attachment.mimeType || 'application/octet-stream',
        size: attachment.size || 0,
        createdAt: now,
      })),
      createdAt: now,
    },
    {
      id: `local-assistant-${now + 1}`,
      turnId,
      sessionId: currentSession?.sessionId ?? null,
      projectId: currentProject?.projectId ?? null,
      runId: currentRun?.runId ?? null,
      modeContext: currentMode,
      role: 'assistant',
      agentId: 'rdc-debugger',
      content: errorMessage,
      status: 'error',
      updatedAt: now,
      reasoningTrace: {
        status: 'error',
        summary: failedSummary,
        steps: [],
        updatedAt: now,
      },
      createdAt: now,
    },
  ];
}
