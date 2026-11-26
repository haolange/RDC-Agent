import { z } from 'zod';
import { MaterialContextSchema } from '@shared/types/materialContext';
import { ipcId, ipcNonEmptyString, ipcString, ipcStringArray } from './IpcPayloadGuard';
import { SessionIdArgsSchema } from './commonIpcSchemas';
import { planReference } from './planSchemas';

const ReasoningSelectionSchema = z.enum(['off', 'on', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

export const ConversationTurnControlsSchema = z
  .object({
    reasoningLevel: ReasoningSelectionSchema,
    maxContextMode: z.boolean(),
    fastModel: z.boolean(),
  })
  .strict();

const ConversationAttachmentInputSchema = z
  .object({
    material: MaterialContextSchema.optional(),
    sourcePath: ipcNonEmptyString(4096, 'sourcePath'),
    fileName: ipcNonEmptyString(512, 'fileName'),
    mimeType: z.union([ipcString(200, 'mimeType'), z.null()]).optional(),
    size: z
      .union([
        z
          .number()
          .int()
          .nonnegative()
          .max(500 * 1024 * 1024),
        z.null(),
      ])
      .optional(),
    stagingId: ipcString(64, 'stagingId').optional(),
  })
  .strict();

const ConversationAttachmentStagePathItemSchema = z
  .object({
    sourcePath: ipcNonEmptyString(4096, 'sourcePath'),
    fileName: ipcString(512, 'fileName').optional(),
  })
  .strict();

const ConversationAttachmentStageBytesItemSchema = z
  .object({
    fileName: ipcNonEmptyString(512, 'fileName'),
    mimeType: z.union([ipcString(200, 'mimeType'), z.null()]).optional(),
    bytesBase64: ipcNonEmptyString(96 * 1024 * 1024, 'bytesBase64'),
  })
  .strict();

export const ConversationStageAttachmentsArgsSchema = z.tuple([
  z
    .object({
      items: z
        .array(z.union([ConversationAttachmentStagePathItemSchema, ConversationAttachmentStageBytesItemSchema]))
        .max(32),
      composerScopeKey: ipcNonEmptyString(256, 'composerScopeKey'),
    })
    .strict(),
]);

export const ConversationReleaseAttachmentsArgsSchema = z.tuple([
  z
    .object({
      stagingIds: z.array(ipcNonEmptyString(64, 'stagingId')).max(32),
    })
    .strict(),
]);

export const ConversationGetAttachmentPreviewArgsSchema = z.tuple([
  z
    .object({
      previewId: ipcNonEmptyString(64, 'previewId'),
      sessionId: ipcId(128, 'sessionId').optional(),
      composerScopeKey: ipcString(256, 'composerScopeKey').optional(),
    })
    .strict(),
]);

export const ConversationAccessAttachmentArgsSchema = z.tuple([
  z
    .object({
      owner: z.discriminatedUnion('scope', [
        z
          .object({
            scope: z.literal('staging'),
            stagingId: z.string().regex(/^[a-f0-9]{32}$/),
            composerScopeKey: ipcNonEmptyString(256, 'composerScopeKey'),
          })
          .strict(),
        z
          .object({
            scope: z.literal('session'),
            attachmentId: ipcNonEmptyString(64, 'attachmentId'),
            sessionId: ipcId(128, 'sessionId'),
          })
          .strict(),
      ]),
      action: z.enum(['preview', 'open', 'reveal']),
    })
    .strict(),
]);

const ConfigurationCommitSchema = z
  .object({
    agentId: ipcNonEmptyString(200, 'agentId'),
    agentCommitHash: ipcString(128, 'agentCommitHash').optional(),
    providerId: ipcString(200, 'providerId').optional(),
    modelId: ipcString(200, 'modelId').optional(),
    providerCommitHash: ipcString(128, 'providerCommitHash').optional(),
    providerCatalogRevision: ipcString(128, 'providerCatalogRevision').optional(),
    routeRevision: ipcString(128, 'routeRevision').optional(),
  })
  .strict();

const NullableId = z.union([ipcId(128, 'id'), z.null()]);

export const ConversationSendRequestSchema = z
  .object({
    planReference: z
      .discriminatedUnion('intent', [
        z.object({ intent: z.literal('revise'), ...planReference }).strict(),
        z
          .object({
            intent: z.literal('execute'),
            planId: planReference.planId,
            revision: planReference.revision,
            sessionId: planReference.sessionId,
            expectedHash: planReference.expectedHash,
          })
          .strict(),
      ])
      .optional(),
    // The turn's ids derive from it (conversationTurnIds), so it keeps to the id grammar and leaves room for their prefix.
    requestId: ipcId(120, 'requestId'),
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
  })
  .strict();

export const ConversationSendMessageArgsSchema = z.tuple([ConversationSendRequestSchema]);

/** A rewrite starts a new turn from an earlier message; it can never execute or revise a reviewed plan. */
export const ConversationRewriteFromMessageArgsSchema = z.tuple([
  ConversationSendRequestSchema.omit({ planReference: true })
    .extend({
      messageId: ipcId(200, 'messageId'),
    })
    .strict(),
]);

export const ConversationGetHistoryArgsSchema = SessionIdArgsSchema;
export const ConversationGetMessageSnapshotArgsSchema = z.tuple([ipcId(200, 'sessionId'), ipcId(200, 'messageId')]);
export const ConversationGetDelegationTraceArgsSchema = z.tuple([
  z
    .object({
      sessionId: ipcId(128, 'sessionId'),
      parentToolCallId: ipcNonEmptyString(200, 'parentToolCallId'),
      cursor: z.number().int().min(0).max(100000).default(0),
      pageSize: z.number().int().min(0).max(120).default(40),
      sinceRevision: z.number().int().min(0).optional(),
    })
    .strict(),
]);
export const ConversationGetDelegationContentArgsSchema = z.tuple([
  z
    .object({
      sessionId: ipcId(128, 'sessionId'),
      parentToolCallId: ipcNonEmptyString(200, 'parentToolCallId'),
      childSessionId: ipcNonEmptyString(256, 'childSessionId'),
      executionId: ipcNonEmptyString(200, 'executionId').optional(),
      generation: z.number().int().min(0).optional(),
      kind: z.enum(['task', 'final', 'invocation', 'parent_receipt', 'tool_receipt', 'sent_prompt']),
      stepId: ipcNonEmptyString(200, 'stepId').optional(),
      offset: z.number().int().min(0).max(8_388_608),
    })
    .strict(),
]);
export const ConversationClearHistoryArgsSchema = SessionIdArgsSchema;
export const ConversationUndoLastTurnArgsSchema = SessionIdArgsSchema;
export const ConversationCompactHistoryArgsSchema = SessionIdArgsSchema;

export const ConversationGetToolImagePreviewArgsSchema = z.tuple([
  z
    .object({
      sessionId: ipcId(128, 'sessionId'),
      previewId: ipcNonEmptyString(64, 'previewId'),
    })
    .strict(),
]);

export const ConversationResolveMediaArgsSchema = z.tuple([
  z
    .object({
      sessionId: ipcId(128, 'sessionId'),
      src: ipcNonEmptyString(4096, 'src'),
    })
    .strict(),
]);

export const ConversationSwitchBranchArgsSchema = z.tuple([
  z
    .object({
      sessionId: ipcId(128, 'sessionId'),
      forkId: ipcId(128, 'forkId'),
      branchId: ipcId(128, 'branchId'),
    })
    .strict(),
]);

export const ConversationCancelActiveTurnArgsSchema = z.tuple([
  z
    .object({
      requestId: ipcString(200, 'requestId').optional(),
      sessionId: ipcId(128, 'sessionId').optional(),
      turnId: ipcNonEmptyString(200, 'turnId').optional(),
    })
    .strict()
    .optional(),
]);

export const ConversationAnswerUserInputArgsSchema = z.tuple([
  z
    .object({
      sessionId: z.union([ipcId(128, 'sessionId'), z.null()]).optional(),
      turnId: ipcNonEmptyString(200, 'turnId'),
      toolCallId: ipcNonEmptyString(200, 'toolCallId'),
      answers: z
        .array(
          z
            .object({
              questionId: ipcNonEmptyString(200, 'questionId'),
              answer: ipcString(20_000, 'answer'),
              selectedOptionId: ipcString(200, 'selectedOptionId').optional(),
              responseKind: z.enum(['answered', 'unknown', 'skipped']).optional(),
            })
            .strict(),
        )
        .max(32),
    })
    .strict(),
]);

/**
 * User's approve/reject answer for an in-turn tool approval prompt.
 * This is not a self-asserted IPC mutation bypass (unlike memory write `approved`).
 */
const PlanReviewAnswerTargetSchema = {
  sessionId: ipcId(128, 'sessionId'),
  reviewId: ipcNonEmptyString(128, 'reviewId'),
};

/** An approval carries the whole decision main commits: the reviewed hash, the handoff, model, controls and base revision. */
export const ConversationAnswerPlanReviewArgsSchema = z.tuple([
  z.union([
    z
      .object({
        ...PlanReviewAnswerTargetSchema,
        decision: z
          .object({
            kind: z.literal('approve'),
            handoff: z
              .object({
                label: ipcNonEmptyString(200, 'label'),
                agent: ipcNonEmptyString(200, 'agent'),
              })
              .strict(),
          })
          .strict(),
        expectedPlanHash: ipcNonEmptyString(128, 'expectedPlanHash'),
        model: z
          .object({
            providerId: ipcNonEmptyString(128, 'providerId'),
            modelId: ipcNonEmptyString(256, 'modelId'),
          })
          .strict(),
        controls: ConversationTurnControlsSchema,
        baseRevision: z
          .object({
            epoch: ipcNonEmptyString(128, 'epoch'),
            n: z.number().int().nonnegative(),
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        ...PlanReviewAnswerTargetSchema,
        decision: z
          .object({
            kind: z.literal('reject'),
            feedback: ipcNonEmptyString(20_000, 'feedback').refine(
              (value) => value.trim().length > 0,
              'feedback is required',
            ),
          })
          .strict(),
      })
      .strict(),
  ]),
]);

export const ConversationAnswerToolApprovalArgsSchema = z.tuple([
  z
    .object({
      sessionId: z.union([ipcId(128, 'sessionId'), z.null()]).optional(),
      turnId: ipcNonEmptyString(200, 'turnId'),
      approvalId: ipcNonEmptyString(200, 'approvalId'),
      approved: z.boolean(),
    })
    .strict(),
]);
