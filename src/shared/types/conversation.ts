import type { AgentRole } from './agent';
import type { DebugPlan, AskUserPrompt } from './workflow';
import type { AppMode, RunSummary, SessionAttachmentRecord, SessionRecord } from './session';

export type ConversationMode = 'talk' | 'intake' | 'active_debug' | 'execute_upgrade';

export type ConversationRole = 'user' | 'assistant' | 'system';

export interface ConversationMessage {
  id: string;
  sessionId: string | null;
  projectId: string | null;
  runId?: string | null;
  modeContext?: AppMode;
  role: ConversationRole;
  agentId?: AgentRole;
  content: string;
  attachments?: SessionAttachmentRecord[];
  createdAt: number;
}

export interface ConversationAttachmentInput {
  sourcePath: string;
  fileName: string;
  mimeType?: string | null;
  size?: number | null;
}

export interface ConversationControl {
  intent: 'talk' | 'intake' | 'execute';
  safe_to_start: boolean;
  needs_project?: boolean;
  needs_capture?: boolean;
  needs_target_capture?: boolean;
  needs_route?: boolean;
  reason?: string;
}

export interface ConversationErrorViewModel {
  code: string;
  message: string;
  technicalMessage?: string;
}

export interface ConversationUiHints {
  showPlanIntake?: boolean;
  highlightProjectPicker?: boolean;
  highlightCaptureLibrary?: boolean;
  highlightSettingsRoute?: boolean;
}

export interface ConversationExecutionTransition {
  action: 'none' | 'started_run';
  runId?: string;
  sessionId?: string;
}

export interface ConversationSendRequest {
  projectId?: string | null;
  sessionId?: string | null;
  currentRunId?: string | null;
  replayDeviceId?: string | null;
  mode: AppMode;
  message: string;
  attachments?: ConversationAttachmentInput[];
}

export interface ConversationTurnResult {
  session: SessionRecord | null;
  mode: ConversationMode;
  userMessage: ConversationMessage;
  assistantMessage: ConversationMessage;
  executionTransition: ConversationExecutionTransition;
  runUpdate?: RunSummary | null;
  debugPlanSummary?: DebugPlan | null;
  pendingQuestions?: AskUserPrompt | null;
  uiHints?: ConversationUiHints;
  errorViewModel?: ConversationErrorViewModel | null;
}
