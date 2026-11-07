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

export const KnowledgeReadArgsSchema = z.tuple([z.object({
  spaceId: KnowledgeSpaceIdSchema,
  relativePath: ipcNonEmptyString(1024, 'relativePath'),
  mode: z.enum(['summary', 'section', 'range', 'full']),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  heading: ipcNonEmptyString(512, 'heading').optional(),
  headingLine: z.number().int().positive().optional(),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
}).strict().superRefine((request, context) => {
  if (request.mode !== 'summary' && !request.contentHash) context.addIssue({ code: 'custom', message: 'contentHash is required for versioned reading.' });
  if (request.mode === 'section' && !request.heading) context.addIssue({ code: 'custom', message: 'heading is required for a section.' });
  if (request.mode === 'range' && (!request.startLine || !request.endLine)) context.addIssue({ code: 'custom', message: 'startLine and endLine are required for a range.' });
})]);

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

export const KnowledgeIndexRebuildArgsSchema = z.tuple([]);

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

export const KnowledgeImportArgsSchema = z.tuple([
  z.object({
    spaceId: KnowledgeSpaceIdSchema,
    sessionId: ipcId(128, 'sessionId').optional(),
    source: ipcString(512 * 1024, 'source').optional(),
    filePath: ipcNonEmptyString(4096, 'filePath').optional(),
  }).strict().refine(
    (value) => Boolean(value.source?.trim() || value.filePath?.trim()),
    { message: 'source or filePath is required' },
  ),
]);

export const KnowledgeImageArgsSchema = z.tuple([
  z.object({
    spaceId: KnowledgeSpaceIdSchema,
    relativePath: ipcNonEmptyString(1024, 'relativePath'),
  }).strict(),
]);

export const KnowledgeIssueApprovalTokenArgsSchema = z.tuple([
  z.object({
    action: z.enum(['knowledge.write', 'knowledge.promote']),
    spaceId: KnowledgeSpaceIdSchema,
    relativePath: ipcNonEmptyString(1024, 'relativePath'),
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
    targetPath: ipcNonEmptyString(4096, 'targetPath'),
    cardRefs: z.array(z.object({
      spaceId: KnowledgeSpaceIdSchema,
      relativePath: ipcNonEmptyString(1024, 'relativePath'),
    }).strict()).max(2000).optional(),
    spaceId: KnowledgeSpaceIdSchema.optional(),
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
