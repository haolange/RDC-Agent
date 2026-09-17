import { z } from 'zod';
import {
  KNOWLEDGE_CARD_TYPES,
  KNOWLEDGE_LIFECYCLES,
  KNOWLEDGE_RETRIEVAL_LANES,
} from '@shared/types/knowledge';
import { KNOWLEDGE_EXPORT_FORMATS, KNOWLEDGE_EXPORT_SCOPES } from '@shared/types/knowledgeExport';
import { KnowledgeCardRecordSchema } from '../../knowledge/knowledgeCardSchema';
import { ipcId, ipcNonEmptyString, ipcString } from './IpcPayloadGuard';

const KnowledgeSpaceIdSchema = ipcNonEmptyString(200, 'spaceId');
const KnowledgePermissionModeSchema = z.enum(['default', 'auto-review', 'full-access', 'custom']);
const KnowledgeConfirmationSchema = z.object({
  explicitHumanConfirmation: z.literal(true),
}).strict();

export const KnowledgeOverviewArgsSchema = z.tuple([]);

export const KnowledgeQueryArgsSchema = z.tuple([
  z.object({
    spaceIds: z.array(KnowledgeSpaceIdSchema).max(64).optional(),
    text: ipcString(4000, 'text').optional(),
    cardId: ipcString(400, 'cardId').optional(),
    relativePath: ipcString(1024, 'relativePath').optional(),
    type: z.array(z.enum(KNOWLEDGE_CARD_TYPES)).max(KNOWLEDGE_CARD_TYPES.length).optional(),
    lifecycle: z.array(z.enum(KNOWLEDGE_LIFECYCLES)).max(KNOWLEDGE_LIFECYCLES.length).optional(),
    relationTargetCardId: ipcString(400, 'relationTargetCardId').optional(),
    asOf: z.number().int().nonnegative().optional(),
    lanes: z.array(z.enum(KNOWLEDGE_RETRIEVAL_LANES)).max(KNOWLEDGE_RETRIEVAL_LANES.length).optional(),
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
    to: z.enum(['verified', 'promoted', 'deprecated']),
    permissionMode: KnowledgePermissionModeSchema,
    confirmation: KnowledgeConfirmationSchema,
    approvalToken: ipcNonEmptyString(128, 'approvalToken'),
  }).strict(),
]);
