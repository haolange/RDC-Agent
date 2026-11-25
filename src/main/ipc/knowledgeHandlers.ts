import path from 'node:path';
import { dialog, ipcMain } from 'electron';
import { KNOWLEDGE_EXPORT_EXTENSION } from '@shared/types/knowledgeExport';
import { AppError } from '@shared/errors/appError';
import { nativeMessage } from '../window/nativeI18n';
import { confirmInMainProcess } from '../window/mainConfirmation';
import { KNOWLEDGE_IMPORT_MAX_BYTES } from '../knowledge/knowledgeIngest';
import { readKnowledgeImagePreview } from '../knowledge/knowledgeImagePreview';
import { knowledgeCandidateService } from '../knowledge/KnowledgeCandidateService';
import { knowledgeImportService } from '../knowledge/KnowledgeImportService';
import { KnowledgeDraftMigrationConflictError } from '../knowledge/knowledgeErrors';
import { knowledgeCompileService } from '../knowledge/KnowledgeCompileService';
import {
  createDefaultExportDependencies,
  KnowledgeExportService,
} from '../knowledge/KnowledgeExportService';
import { knowledgeIndexService } from '../knowledge/KnowledgeIndexService';
import { knowledgeQueryService } from '../knowledge/KnowledgeQueryService';
import { knowledgeWriteService } from '../knowledge/KnowledgeWriteService';
import { knowledgeTopicService } from '../knowledge/KnowledgeTopicService';
import { KnowledgeOperationRegistry } from '../knowledge/knowledgeOperations';
import { shutdownCoordinator } from '../lifecycle/ShutdownCoordinator';
import { runtimeLogService } from '../runtime/RuntimeLogService';
import { ipcApprovalTokenService } from '../runtime/IpcApprovalTokenService';
import { sha256Hex } from '../runtime/contentHash';
import { serializeKnowledgeCard } from '../knowledge/knowledgeCardSchema';
import { IpcValidationError, parseIpcArgs } from './validation/IpcPayloadGuard';
import {
  KnowledgeCandidateCreateArgsSchema,
  KnowledgeCancelArgsSchema,
  KnowledgeCandidatesArgsSchema,
  KnowledgeCardArgsSchema,
  KnowledgeImportArgsSchema,
  KnowledgeImportPreviewArgsSchema,
  KnowledgeImageArgsSchema,
  KnowledgeCompileArgsSchema,
  KnowledgeIndexRebuildArgsSchema,
  KnowledgeIssueApprovalTokenArgsSchema,
  KnowledgeOverviewArgsSchema,
  KnowledgePromoteArgsSchema,
  KnowledgeQueryArgsSchema,
  KnowledgeExportArgsSchema,
  KnowledgeWriteArgsSchema,
  KnowledgeTopicSuggestArgsSchema,
  KnowledgeTopicPreviewArgsSchema,
  KnowledgeTopicApplyArgsSchema,
} from './validation/knowledgeSchemas';
import type { KnowledgeCardRecord, KnowledgeIndexOverview, KnowledgeQueryRequest, KnowledgeSpace } from '@shared/types/knowledge';
import type { WorkbenchIpcContext } from './workbenchContext';

const knowledgeExportService = new KnowledgeExportService(createDefaultExportDependencies({
  getCard: (spaceId, relativePath) => knowledgeQueryService.getCard(spaceId, relativePath),
  listCards: (spaceId) => knowledgeQueryService.listCards(spaceId),
  listSpaces: () => knowledgeQueryService.listSpaces(),
}));

function assertKnownSpaces(spaceIds: string[] | undefined): void {
  if (!spaceIds?.length) return;
  const known = new Set(knowledgeQueryService.listSpaces().map((space) => space.spaceId));
  for (const spaceId of spaceIds) {
    if (!known.has(spaceId)) {
      const error = new Error(`Unknown knowledge space: ${spaceId}`);
      (error as Error & { code: string }).code = 'KNOWLEDGE_SPACE_UNKNOWN';
      throw error;
    }
  }
}

function requireHumanConfirmation(confirmation: { explicitHumanConfirmation?: boolean }): void {
  if (confirmation.explicitHumanConfirmation !== true) {
    const error = new AppError('KNOWLEDGE_HUMAN_CONFIRMATION_REQUIRED');
    (error as Error & { code: string }).code = 'KNOWLEDGE_HUMAN_CONFIRMATION_REQUIRED';
    throw error;
  }
}

function knowledgeTokenBinding(spaceId: string, relativePath: string): {
  scope: 'user' | 'project';
  name: string;
  projectRoot?: string;
} {
  const space = knowledgeQueryService.listSpaces().find((entry) => entry.spaceId === spaceId);
  return knowledgeSpaceTokenBinding(space, relativePath);
}

function knowledgeSpaceTokenBinding(
  space: KnowledgeSpace | undefined,
  relativePath: string,
): {
  scope: 'user' | 'project';
  name: string;
  projectRoot?: string;
} {
  if (space?.kind === 'project') {
    return { scope: 'project', name: relativePath, projectRoot: space.rootPath };
  }
  return { scope: 'user', name: relativePath };
}

async function confirmKnowledgeMutation(
  action: 'knowledge.write' | 'knowledge.promote',
  spaceId: string,
  relativePath: string,
): Promise<boolean> {
  return confirmInMainProcess({
    action,
    title: nativeMessage('knowledgeTitle'),
    message: nativeMessage(action === 'knowledge.write' ? 'knowledgeWrite' : 'knowledgePromote'),
    detail: `${spaceId} / ${relativePath}`,
    confirmLabel: nativeMessage('allowOnce'),
    cancelLabel: nativeMessage('cancel'),
  });
}

/** The approved content: the card exactly as it will be serialized, so a token cannot carry a different card. */
function knowledgeCardDigest(card: KnowledgeCardRecord): string {
  return sha256Hex(serializeKnowledgeCard(card));
}

function consumeKnowledgeToken(
  token: string,
  action: 'knowledge.write' | 'knowledge.promote',
  spaceId: string,
  card: KnowledgeCardRecord,
): void {
  const consumed = ipcApprovalTokenService.consume({
    token,
    action,
    ...knowledgeTokenBinding(spaceId, card.relativePath),
    contentDigest: knowledgeCardDigest(card),
  });
  if (!consumed) {
    const error = new AppError('KNOWLEDGE_APPROVAL_TOKEN_INVALID');
    (error as Error & { code: string }).code = 'KNOWLEDGE_APPROVAL_TOKEN_INVALID';
    throw error;
  }
}

/**
 * The index follows the cards on its own: queries rebuild a stale snapshot, and the overview reads the same current
 * index. It is null only when the index could not be built, which is when the Knowledge Center offers a rebuild.
 */
async function toIndexOverview(): Promise<KnowledgeIndexOverview | null> {
  const snapshot = await knowledgeIndexService.getOrRebuild().catch(() => null);
  if (!snapshot) return null;
  const cardsBySpace: Record<string, number> = {};
  for (const card of snapshot.cards) {
    cardsBySpace[card.spaceId] = (cardsBySpace[card.spaceId] ?? 0) + 1;
  }
  return {
    revision: snapshot.revision,
    builtAt: snapshot.builtAt,
    cardCount: snapshot.cards.length,
    cardsBySpace,
  };
}

function toQueryRequest(input: {
  spaceIds?: string[];
  text?: string;
  cardId?: string;
  relativePath?: string;
  type?: KnowledgeQueryRequest['type'];
  lifecycle?: KnowledgeQueryRequest['lifecycle'];
  relationTargetCardId?: string;
  scope?: KnowledgeQueryRequest['scope'];
  asOf?: number;
  lanes?: KnowledgeQueryRequest['lanes'];
  offset?: number;
  limit?: number;
  expectedRevision?: string;
}): KnowledgeQueryRequest {
  return {
    ...(input.spaceIds ? { spaceIds: input.spaceIds } : {}),
    ...(input.text ? { text: input.text } : {}),
    ...(input.cardId ? { cardId: input.cardId } : {}),
    ...(input.relativePath ? { relativePath: input.relativePath } : {}),
    ...(input.type ? { type: input.type } : {}),
    ...(input.lifecycle ? { lifecycle: input.lifecycle } : {}),
    ...(input.relationTargetCardId ? { relationTargetCardId: input.relationTargetCardId } : {}),
    ...(input.scope ? { scope: input.scope } : {}),
    ...(input.asOf != null ? { asOf: input.asOf } : {}),
    ...(input.lanes ? { lanes: input.lanes } : {}),
    ...(input.offset !== undefined ? { offset: input.offset } : {}),
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
    ...(input.expectedRevision ? { expectedRevision: input.expectedRevision } : {}),
  };
}

function rethrowKnowledgeError(error: unknown): never {
  if (error && typeof error === 'object' && 'code' in error) {
    throw error;
  }
  throw error;
}

export function registerKnowledgeHandlers(context: WorkbenchIpcContext): void {
  // Import, export and rebuild run under a renderer-chosen id: progress goes out on `knowledge:progress`, and
  // `knowledge:cancel` stops the run between items. Quitting stops every run and waits for it to settle.
  const operations = new KnowledgeOperationRegistry((progress) => context.broadcastToRenderer('knowledge:progress', progress));
  shutdownCoordinator.register({ id: 'knowledge-operations.abort', phase: 'abort_all', dispose: () => operations.abortAll() });

  ipcMain.handle('knowledge:cancel', async (_event, ...rawArgs: unknown[]) => {
    const [input] = parseIpcArgs(KnowledgeCancelArgsSchema, rawArgs, { label: 'knowledge:cancel', maxBytes: 1024 });
    return { cancelled: operations.cancel(input.operationId) };
  });

  ipcMain.handle('knowledge:topics:suggest', async (_event, ...rawArgs: unknown[]) => {
    parseIpcArgs(KnowledgeTopicSuggestArgsSchema, rawArgs, { label: 'knowledge:topics:suggest', maxBytes: 1024 });
    return knowledgeTopicService.suggest();
  });

  ipcMain.handle('knowledge:topics:preview', async (_event, ...rawArgs: unknown[]) => {
    const [changes] = parseIpcArgs(KnowledgeTopicPreviewArgsSchema, rawArgs, { label: 'knowledge:topics:preview', maxBytes: 2 * 1024 * 1024 });
    return knowledgeTopicService.preview(changes);
  });

  ipcMain.handle('knowledge:topics:apply', async (_event, ...rawArgs: unknown[]) => {
    const [input] = parseIpcArgs(KnowledgeTopicApplyArgsSchema, rawArgs, { label: 'knowledge:topics:apply', maxBytes: 2 * 1024 * 1024 });
    const preview = await knowledgeTopicService.preview(input.changes);
    if (preview.changeHash !== input.changeHash) throw new AppError('KNOWLEDGE_TOPICS_PREVIEW_CHANGED', 'review the changes again.');
    const detail = `topics: ${preview.topics.map(topic => topic.label).join(', ')}; cards: ${preview.cards.length}`;
    if (!await confirmKnowledgeMutation('knowledge.write', 'user', detail)) return { cancelled: true as const };
    return knowledgeTopicService.apply(input.changes, input.changeHash);
  });

  ipcMain.handle('knowledge:overview', async (_event, ...rawArgs: unknown[]) => {
    parseIpcArgs(KnowledgeOverviewArgsSchema, rawArgs, { label: 'knowledge:overview', maxBytes: 1024 });
    return {
      spaces: knowledgeQueryService.listSpaces(),
      index: await toIndexOverview(),
    };
  });

  ipcMain.handle('knowledge:query', async (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(KnowledgeQueryArgsSchema, rawArgs, {
      label: 'knowledge:query',
      maxBytes: 16 * 1024,
    });
    try {
      assertKnownSpaces(request.spaceIds);
      return await knowledgeQueryService.query(toQueryRequest(request));
    } catch (error) {
      rethrowKnowledgeError(error);
    }
  });

  ipcMain.handle('knowledge:card', async (_event, ...rawArgs: unknown[]) => {
    const [spaceId, relativePath] = parseIpcArgs(KnowledgeCardArgsSchema, rawArgs, {
      label: 'knowledge:card',
      maxBytes: 8 * 1024,
    });
    try {
      assertKnownSpaces([spaceId.trim()]);
      return {
        card: await knowledgeQueryService.getCard(spaceId.trim(), relativePath.trim()),
      };
    } catch (error) {
      rethrowKnowledgeError(error);
    }
  });

  ipcMain.handle('knowledge:compile', async (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(KnowledgeCompileArgsSchema, rawArgs, {
      label: 'knowledge:compile',
      maxBytes: 16 * 1024,
    });
    try {
      assertKnownSpaces(request.spaceIds);
      const query = await knowledgeQueryService.query(toQueryRequest(request));
      return knowledgeCompileService.compile(query, { limit: request.limit ?? 12 });
    } catch (error) {
      rethrowKnowledgeError(error);
    }
  });

  ipcMain.handle('knowledge:index:rebuild', async (_event, ...rawArgs: unknown[]) => {
    const [input] = parseIpcArgs(KnowledgeIndexRebuildArgsSchema, rawArgs, {
      label: 'knowledge:index:rebuild',
      maxBytes: 1024,
    });
    try {
      const snapshot = await operations.run(input.operationId, (options) => knowledgeIndexService.rebuild(options));
      return {
        revision: snapshot.revision,
        builtAt: snapshot.builtAt,
        cardCount: snapshot.cards.length,
      };
    } catch (error) {
      rethrowKnowledgeError(error);
    }
  });

  ipcMain.handle('knowledge:candidates', async (_event, ...rawArgs: unknown[]) => {
    const [sessionId] = parseIpcArgs(KnowledgeCandidatesArgsSchema, rawArgs, {
      label: 'knowledge:candidates',
      maxBytes: 4 * 1024,
    });
    try {
      await knowledgeImportService.migrateSessionDrafts(sessionId);
    } catch (error) {
      if (!(error instanceof KnowledgeDraftMigrationConflictError)) {
        rethrowKnowledgeError(error);
      }
      runtimeLogService.log({
        scope: 'app',
        namespace: 'context',
        severity: 'warning',
        title: 'Knowledge session draft migration conflict',
        summary: 'Unreviewed session drafts were not written because the target space already has a different card at the same identity.',
        raw: { sessionId, cardIds: error.cardIds },
      });
    }
    return {
      candidates: await knowledgeCandidateService.listCandidates(sessionId),
    };
  });

  ipcMain.handle('knowledge:candidateCreate', async (_event, ...rawArgs: unknown[]) => {
    const [input] = parseIpcArgs(KnowledgeCandidateCreateArgsSchema, rawArgs, {
      label: 'knowledge:candidateCreate',
      maxBytes: 256 * 1024,
    });
    try {
      if (input.card.spaceId) assertKnownSpaces([input.card.spaceId]);
      return await knowledgeCandidateService.createCandidate({
        sessionId: input.sessionId,
        card: input.card,
        explicitUserIntent: true,
      });
    } catch (error) {
      rethrowKnowledgeError(error);
    }
  });

  ipcMain.handle('knowledge:previewImport', async (_event, ...rawArgs: unknown[]) => {
    const [input] = parseIpcArgs(KnowledgeImportPreviewArgsSchema, rawArgs, {
      label: 'knowledge:previewImport',
      maxBytes: KNOWLEDGE_IMPORT_MAX_BYTES + 8 * 1024,
    });
    try {
      assertKnownSpaces([input.spaceId]);
      return await knowledgeImportService.previewImport({
        spaceId: input.spaceId,
        ...(input.filePath ? { filePath: input.filePath } : { source: input.source ?? '' }),
      });
    } catch (error) {
      rethrowKnowledgeError(error);
    }
  });

  ipcMain.handle('knowledge:import', async (_event, ...rawArgs: unknown[]) => {
    const [input] = parseIpcArgs(KnowledgeImportArgsSchema, rawArgs, {
      label: 'knowledge:import',
      maxBytes: KNOWLEDGE_IMPORT_MAX_BYTES + 8 * 1024,
    });
    try {
      assertKnownSpaces([input.spaceId]);
      return await operations.run(input.operationId, async (options) => {
        // Imported cards become context the Agent trusts, so the person confirms in main, not the renderer.
        const importedFrom = input.filePath ? path.basename(input.filePath) : nativeMessage('pastedText', { count: (input.source ?? '').length });
        if (!await confirmKnowledgeMutation('knowledge.write', input.spaceId, importedFrom)) return { cancelled: true as const };
        options.signal.throwIfAborted();
        if (input.sessionId) {
          try {
            await knowledgeImportService.migrateSessionDrafts(input.sessionId);
          } catch (error) {
            if (!(error instanceof KnowledgeDraftMigrationConflictError)) throw error;
            runtimeLogService.log({
              scope: 'app',
              namespace: 'context',
              severity: 'warning',
              title: 'Knowledge session draft migration conflict',
              summary: 'Unreviewed session drafts were not written because the target space already has a different card at the same identity.',
              raw: { sessionId: input.sessionId, cardIds: error.cardIds },
            });
          }
        }
        return await knowledgeImportService.importToSpace({
          spaceId: input.spaceId,
          ...(input.filePath ? { filePath: input.filePath } : { source: input.source ?? '' }),
        }, options);
      });
    } catch (error) {
      rethrowKnowledgeError(error);
    }
  });

  ipcMain.handle('knowledge:image', async (_event, ...rawArgs: unknown[]) => {
    const [input] = parseIpcArgs(KnowledgeImageArgsSchema, rawArgs, {
      label: 'knowledge:image',
      maxBytes: 4 * 1024,
    });
    try {
      assertKnownSpaces([input.spaceId]);
      return await readKnowledgeImagePreview({
        spaces: knowledgeQueryService.listSpaces(),
        spaceId: input.spaceId,
        relativePath: input.relativePath,
      });
    } catch (error) {
      rethrowKnowledgeError(error);
    }
  });

  ipcMain.handle('knowledge:issueApprovalToken', async (_event, ...rawArgs: unknown[]) => {
    try {
      const [input] = parseIpcArgs(KnowledgeIssueApprovalTokenArgsSchema, rawArgs, {
        label: 'knowledge:issueApprovalToken',
        maxBytes: 256 * 1024,
      });
      assertKnownSpaces([input.spaceId]);
      const confirmed = await confirmKnowledgeMutation(input.action, input.spaceId, input.card.relativePath);
      if (!confirmed) {
        return { error: 'Knowledge mutation was not confirmed by the main-process dialog.' };
      }
      const space = knowledgeQueryService.listSpaces().find((entry) => entry.spaceId === input.spaceId);
      return {
        token: ipcApprovalTokenService.issue({
          action: input.action,
          ...knowledgeSpaceTokenBinding(space, input.card.relativePath),
          contentDigest: knowledgeCardDigest(input.card),
        }),
      };
    } catch (error) {
      if (error instanceof IpcValidationError) {
        return { error: error.message };
      }
      throw error;
    }
  });

  ipcMain.handle('knowledge:write', async (_event, ...rawArgs: unknown[]) => {
    const [input] = parseIpcArgs(KnowledgeWriteArgsSchema, rawArgs, {
      label: 'knowledge:write',
      maxBytes: 256 * 1024,
    });
    try {
      assertKnownSpaces([input.spaceId]);
      requireHumanConfirmation(input.confirmation);
      consumeKnowledgeToken(input.approvalToken, 'knowledge.write', input.spaceId, input.card);
      return {
        card: await knowledgeWriteService.write(input),
      };
    } catch (error) {
      rethrowKnowledgeError(error);
    }
  });

  ipcMain.handle('knowledge:export', async (_event, ...rawArgs: unknown[]) => {
    const [input] = parseIpcArgs(KnowledgeExportArgsSchema, rawArgs, {
      label: 'knowledge:export',
      maxBytes: 256 * 1024,
    });
    const { operationId, ...request } = input;
    try {
      const spaceIds = request.scope === 'space'
        ? [request.spaceId].filter((value): value is string => Boolean(value))
        : (request.cardRefs ?? []).map((ref) => ref.spaceId);
      assertKnownSpaces([...new Set(spaceIds)]);
      return await operations.run(operationId, async (options) => {
        // Main owns the destination: the renderer asks to export, the person picks where in a native dialog.
        const extension = KNOWLEDGE_EXPORT_EXTENSION[request.format];
        const picked = await dialog.showSaveDialog({
          title: nativeMessage('exportKnowledge'),
          defaultPath: `knowledge-export.${extension}`,
          filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
          properties: ['createDirectory', 'showOverwriteConfirmation'],
        });
        if (picked.canceled || !picked.filePath) return null;
        options.signal.throwIfAborted();
        return await knowledgeExportService.export(request, picked.filePath, options);
      });
    } catch (error) {
      rethrowKnowledgeError(error);
    }
  });

  ipcMain.handle('knowledge:promote', async (_event, ...rawArgs: unknown[]) => {
    const [input] = parseIpcArgs(KnowledgePromoteArgsSchema, rawArgs, {
      label: 'knowledge:promote',
      maxBytes: 256 * 1024,
    });
    try {
      assertKnownSpaces([input.spaceId]);
      requireHumanConfirmation(input.confirmation);
      consumeKnowledgeToken(input.approvalToken, 'knowledge.promote', input.spaceId, input.card);
      return {
        card: await knowledgeWriteService.promote(input),
      };
    } catch (error) {
      rethrowKnowledgeError(error);
    }
  });
}
