import { z } from 'zod';
import {
  KNOWLEDGE_CARD_TYPES,
  KNOWLEDGE_LIFECYCLES,
  KNOWLEDGE_RETRIEVAL_LANES,
} from '@shared/types/knowledge';
import { KNOWLEDGE_EXPORT_FORMATS, KNOWLEDGE_EXPORT_SCOPES } from '@shared/types/knowledgeExport';
import { KnowledgeCardRecordSchema, KnowledgeScopeSchema } from '../../knowledge/knowledgeCardSchema';
import { KnowledgeTopicChangesSchema } from '../../knowledge/KnowledgeTopicStore';
import { ipcId, ipcNonEmptyString, ipcString } from './IpcPayloadGuard';

const KnowledgeSpaceIdSchema = ipcNonEmptyString(200, 'spaceId');
/** Names one long operation (import, export, rebuild) so its progress and cancellation reach the right run. */
const KnowledgeOperationIdSchema = ipcId(128, 'operationId');
const KnowledgePermissionModeSchema = z.enum(['default', 'auto-review', 'full-access', 'custom']);
const KnowledgeConfirmationSchema = z.object({
  explicitHumanConfirmation: z.literal(true),
}).strict();

export const KnowledgeOverviewArgsSchema = z.tuple([]);
export const KnowledgeTopicSuggestArgsSchema = z.tuple([]);
export const KnowledgeTopicPreviewArgsSchema = z.tuple([KnowledgeTopicChangesSchema]);
export const KnowledgeTopicApplyArgsSchema = z.tuple([z.object({
  changes: KnowledgeTopicChangesSchema,
  changeHash: z.string().regex(/^[a-f0-9]{64}$/u),
  confirmation: z.object({ explicitHumanConfirmation: z.literal(true) }).strict(),
}).strict()]);

export const KnowledgeQueryArgsSchema = z.tuple([
  z.object({
    spaceIds: z.array(KnowledgeSpaceIdSchema).max(64).optional(),
    text: ipcString(4000, 'text').optional(),
    cardId: ipcString(400, 'cardId').optional(),
    relativePath: ipcString(1024, 'relativePath').optional(),
    type: z.array(z.enum(KNOWLEDGE_CARD_TYPES)).max(KNOWLEDGE_CARD_TYPES.length).optional(),
    lifecycle: z.array(z.enum(KNOWLEDGE_LIFECYCLES)).max(KNOWLEDGE_LIFECYCLES.length).optional(),
    relationTargetCardId: ipcString(400, 'relationTargetCardId').optional(),
    scope: KnowledgeScopeSchema.optional(),
    asOf: z.number().int().nonnegative().optional(),
    lanes: z.array(z.enum(KNOWLEDGE_RETRIEVAL_LANES)).max(KNOWLEDGE_RETRIEVAL_LANES.length).optional(),
    offset: z.number().int().nonnegative().optional(),
    limit: z.number().int().min(1).max(100).optional(),
    expectedRevision: ipcNonEmptyString(128, 'expectedRevision').optional(),
  }).strict(),
]);

export const KnowledgeCardArgsSchema = z.tuple([
  KnowledgeSpaceIdSchema,
  ipcNonEmptyString(1024, 'relativePath'),
]);

export const KnowledgeCompileArgsSchema = z.tuple([
  z.object({
    spaceIds: z.array(KnowledgeSpaceIdSchema).max(64).optional(),
    text: ipcString(4000, 'text').optional(),
    type: z.array(z.enum(KNOWLEDGE_CARD_TYPES)).max(KNOWLEDGE_CARD_TYPES.length).optional(),
    lifecycle: z.array(z.enum(KNOWLEDGE_LIFECYCLES)).max(KNOWLEDGE_LIFECYCLES.length).optional(),
    scope: KnowledgeScopeSchema.optional(),
    asOf: z.number().int().nonnegative().optional(),
    lanes: z.array(z.enum(KNOWLEDGE_RETRIEVAL_LANES)).max(KNOWLEDGE_RETRIEVAL_LANES.length).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }).strict(),
]);

export const KnowledgeIndexRebuildArgsSchema = z.tuple([z.object({ operationId: KnowledgeOperationIdSchema }).strict()]);

export const KnowledgeCancelArgsSchema = z.tuple([z.object({ operationId: KnowledgeOperationIdSchema }).strict()]);

export const KnowledgeCandidatesArgsSchema = z.tuple([
  ipcId(128, 'sessionId'),
]);

export const KnowledgeCandidateCreateArgsSchema = z.tuple([
  z.object({
    sessionId: ipcId(128, 'sessionId'),
    card: KnowledgeCardRecordSchema,
    explicitUserIntent: z.literal(true),
  }).strict(),
]);

const knowledgeImportSource = {
  spaceId: KnowledgeSpaceIdSchema,
  source: ipcString(512 * 1024, 'source').optional(),
  filePath: ipcNonEmptyString(4096, 'filePath').optional(),
};
const hasImportSource = (value: { source?: string; filePath?: string }) => Boolean(value.source?.trim() || value.filePath?.trim());

export const KnowledgeImportArgsSchema = z.tuple([
  z.object({ ...knowledgeImportSource, sessionId: ipcId(128, 'sessionId').optional(), operationId: KnowledgeOperationIdSchema }).strict()
    .refine(hasImportSource, { message: 'source or filePath is required' }),
]);

/** A preview reads the same source the import would, for the same target space, and writes nothing. */
export const KnowledgeImportPreviewArgsSchema = z.tuple([
  z.object(knowledgeImportSource).strict().refine(hasImportSource, { message: 'source or filePath is required' }),
]);

export const KnowledgeImageArgsSchema = z.tuple([
  z.object({
    spaceId: KnowledgeSpaceIdSchema,
    relativePath: ipcNonEmptyString(1024, 'relativePath'),
  }).strict(),
]);

/** The card the person approves; the token is bound to its serialized bytes, so a different card cannot use it. */
export const KnowledgeIssueApprovalTokenArgsSchema = z.tuple([
  z.object({
    action: z.enum(['knowledge.write', 'knowledge.promote']),
    spaceId: KnowledgeSpaceIdSchema,
    card: KnowledgeCardRecordSchema,
  }).strict(),
]);

export const KnowledgeWriteArgsSchema = z.tuple([
  z.object({
    spaceId: KnowledgeSpaceIdSchema,
    card: KnowledgeCardRecordSchema,
    permissionMode: KnowledgePermissionModeSchema,
    confirmation: KnowledgeConfirmationSchema,
    approvalToken: ipcNonEmptyString(128, 'approvalToken'),
  }).strict(),
]);

export const KnowledgeExportArgsSchema = z.tuple([
  z.object({
    format: z.enum(KNOWLEDGE_EXPORT_FORMATS),
    scope: z.enum(KNOWLEDGE_EXPORT_SCOPES),
    cardRefs: z.array(z.object({
      spaceId: KnowledgeSpaceIdSchema,
      relativePath: ipcNonEmptyString(1024, 'relativePath'),
    }).strict()).max(2000).optional(),
    spaceId: KnowledgeSpaceIdSchema.optional(),
    operationId: KnowledgeOperationIdSchema,
  }).strict(),
]);

export const KnowledgePromoteArgsSchema = z.tuple([
  z.object({
    spaceId: KnowledgeSpaceIdSchema,
    card: KnowledgeCardRecordSchema,
    to: z.enum(['verified', 'promoted', 'retired']),
    permissionMode: KnowledgePermissionModeSchema,
    confirmation: KnowledgeConfirmationSchema,
    approvalToken: ipcNonEmptyString(128, 'approvalToken'),
  }).strict(),
]);
