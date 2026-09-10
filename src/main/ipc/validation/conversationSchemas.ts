import { MaterialContextSchema } from '@shared/types/materialContext';
import { z } from 'zod';
import { ipcId, ipcNonEmptyString, ipcString, ipcStringArray } from './IpcPayloadGuard';
import { SessionIdArgsSchema } from './commonIpcSchemas';

const ReasoningSelectionSchema = z.enum([
  'off',
  'on',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

const ConversationTurnControlsSchema = z.object({
  reasoningLevel: ReasoningSelectionSchema,
  maxContextMode: z.boolean(),
  fastModel: z.boolean(),
}).strict();

const ConversationAttachmentInputSchema = z.object({
  material: MaterialContextSchema.optional(),
  sourcePath: ipcNonEmptyString(4096, 'sourcePath'),
  fileName: ipcNonEmptyString(512, 'fileName'),
  mimeType: z.union([ipcString(200, 'mimeType'), z.null()]).optional(),
  size: z.union([z.number().int().nonnegative().max(500 * 1024 * 1024), z.null()]).optional(),
  stagingId: ipcString(64, 'stagingId').optional(),
}).strict();

const ConversationAttachmentStagePathItemSchema = z.object({
  sourcePath: ipcNonEmptyString(4096, 'sourcePath'),
  fileName: ipcString(512, 'fileName').optional(),
}).strict();

const ConversationAttachmentStageBytesItemSchema = z.object({
  fileName: ipcNonEmptyString(512, 'fileName'),
  mimeType: z.union([ipcString(200, 'mimeType'), z.null()]).optional(),
  bytesBase64: ipcNonEmptyString(96 * 1024 * 1024, 'bytesBase64'),
}).strict();

export const ConversationStageAttachmentsArgsSchema = z.tuple([
  z.object({
    items: z.array(z.union([
      ConversationAttachmentStagePathItemSchema,
      ConversationAttachmentStageBytesItemSchema,
    ])).max(32),
    composerScopeKey: ipcNonEmptyString(256, 'composerScopeKey'),
  }).strict(),
]);

export const ConversationReleaseAttachmentsArgsSchema = z.tuple([
  z.object({
    stagingIds: z.array(ipcNonEmptyString(64, 'stagingId')).max(32),
  }).strict(),
]);

export const ConversationGetAttachmentPreviewArgsSchema = z.tuple([
  z.object({
    previewId: ipcNonEmptyString(64, 'previewId'),
    sessionId: ipcId(128, 'sessionId').optional(),
    composerScopeKey: ipcString(256, 'composerScopeKey').optional(),
  }).strict(),
]);

const ConfigurationCommitSchema = z.object({
  agentId: ipcNonEmptyString(200, 'agentId'),
  agentCommitHash: ipcString(128, 'agentCommitHash').optional(),
  providerId: ipcString(200, 'providerId').optional(),
  modelId: ipcString(200, 'modelId').optional(),
  providerCommitHash: ipcString(128, 'providerCommitHash').optional(),
  providerCatalogRevision: ipcString(128, 'providerCatalogRevision').optional(),
  routeRevision: ipcString(128, 'routeRevision').optional(),
}).strict();

const NullableId = z.union([ipcId(128, 'id'), z.null()]);

export const ConversationSendRequestSchema = z.object({
  requestId: ipcNonEmptyString(200, 'requestId'),
  projectId: NullableId.optional(),
  sessionId: NullableId.optional(),
  currentRunId: NullableId.optional(),
  replayDeviceId: NullableId.optional(),
  agentId: z.union([ipcNonEmptyString(200, 'agentId'), z.null()]).optional(),
  profileId: z.union([ipcNonEmptyString(200, 'profileId'), z.null()]).optional(),
  message: ipcString(200_000, 'message'),
  attachments: z.array(ConversationAttachmentInputSchema).max(32).optional(),
  preloadSkillIds: ipcStringArray(64, 200, 'preloadSkillIds').optional(),
  turnControls: ConversationTurnControlsSchema,
  configurationCommit: ConfigurationCommitSchema.optional(),
}).strict();

export const ConversationSendMessageArgsSchema = z.tuple([
  ConversationSendRequestSchema,
]);

export const ConversationRewriteFromMessageArgsSchema = z.tuple([
  ConversationSendRequestSchema.extend({
    messageId: ipcId(200, 'messageId'),
  }).strict(),
]);

export const ConversationGetHistoryArgsSchema = SessionIdArgsSchema;
export const ConversationClearHistoryArgsSchema = SessionIdArgsSchema;
export const ConversationUndoLastTurnArgsSchema = SessionIdArgsSchema;
export const ConversationCompactHistoryArgsSchema = SessionIdArgsSchema;

export const ConversationGetToolImagePreviewArgsSchema = z.tuple([
  z.object({
    sessionId: ipcId(128, 'sessionId'),
    previewId: ipcNonEmptyString(64, 'previewId'),
  }).strict(),
]);

export const ConversationSwitchBranchArgsSchema = z.tuple([
  z.object({
    sessionId: ipcId(128, 'sessionId'),
    forkId: ipcId(128, 'forkId'),
    branchId: ipcId(128, 'branchId'),
  }).strict(),
]);

export const ConversationCancelActiveTurnArgsSchema = z.tuple([
  z.object({
    requestId: ipcString(200, 'requestId').optional(),
    sessionId: ipcId(128, 'sessionId').optional(),
    turnId: ipcNonEmptyString(200, 'turnId').optional(),
  }).strict().optional(),
]);

export const ConversationAnswerUserInputArgsSchema = z.tuple([
  z.object({
    sessionId: z.union([ipcId(128, 'sessionId'), z.null()]).optional(),
    turnId: ipcNonEmptyString(200, 'turnId'),
    toolCallId: ipcNonEmptyString(200, 'toolCallId'),
    answers: z.array(z.object({
      questionId: ipcNonEmptyString(200, 'questionId'),
      answer: ipcString(20_000, 'answer'),
      selectedOptionId: ipcString(200, 'selectedOptionId').optional(),
      responseKind: z.enum(['answered', 'unknown', 'skipped']).optional(),
    }).strict()).max(32),
  }).strict(),
]);

/**
 * User's approve/reject answer for an in-turn tool approval prompt.
 * This is not a self-asserted IPC mutation bypass (unlike memory write `approved`).
 */
export const ConversationAnswerToolApprovalArgsSchema = z.tuple([
  z.object({
    sessionId: z.union([ipcId(128, 'sessionId'), z.null()]).optional(),
    turnId: ipcNonEmptyString(200, 'turnId'),
    approvalId: ipcNonEmptyString(200, 'approvalId'),
    approved: z.boolean(),
  }).strict(),
]);
