import { BrowserWindow, dialog, ipcMain } from 'electron';
import type { KnowledgeIndexOverview, KnowledgeQueryRequest, KnowledgeSpace } from '@shared/types/knowledge';
import { COLD_DATA_MAX_BYTES } from '../knowledge/coldDataIngest';
import { knowledgeCandidateService } from '../knowledge/KnowledgeCandidateService';
import { knowledgeCompileService } from '../knowledge/KnowledgeCompileService';
import {
  createDefaultExportDependencies,
  KnowledgeExportService,
} from '../knowledge/KnowledgeExportService';
import { knowledgeIndexService } from '../knowledge/KnowledgeIndexService';
import { knowledgeQueryService } from '../knowledge/KnowledgeQueryService';
import { knowledgeWriteService } from '../knowledge/KnowledgeWriteService';
import { runtimeLogService } from '../runtime/RuntimeLogService';
import type { WorkbenchIpcContext } from './workbenchContext';
import { IpcValidationError, parseIpcArgs } from './validation/IpcPayloadGuard';
import { ipcApprovalTokenService } from './validation/IpcApprovalTokenService';
import {
  KnowledgeCandidateCreateArgsSchema,
  KnowledgeCandidatesArgsSchema,
  KnowledgeCardArgsSchema,
  KnowledgeColdDataImportArgsSchema,
  KnowledgeCompileArgsSchema,
  KnowledgeIndexRebuildArgsSchema,
  KnowledgeIssueApprovalTokenArgsSchema,
  KnowledgeOverviewArgsSchema,
  KnowledgePromoteArgsSchema,
  KnowledgeQueryArgsSchema,
  KnowledgeExportArgsSchema,
  KnowledgeWriteArgsSchema,
} from './validation/knowledgeSchemas';

const knowledgeExportService = new KnowledgeExportService(createDefaultExportDependencies({
  getCard: (spaceId, relativePath) => knowledgeQueryService.getCard(spaceId, relativePath),
  listCards: (spaceId) => knowledgeQueryService.listCards(spaceId),
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
    const error = new Error('KNOWLEDGE_HUMAN_CONFIRMATION_REQUIRED');
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
  if (process.env.RDC_AGENT_TEST_MODE === '1') return true;
  if (process.env.RDC_AGENT_BROWSER_QA === '1') {
    const owner = BrowserWindow.getFocusedWindow() ?? undefined;
    if (!owner && process.env.RDC_AGENT_BROWSER_QA_FULL_ACCESS === '1') {
      runtimeLogService.log({
        scope: 'app',
        namespace: 'context',
        severity: 'warning',
        title: 'Browser QA knowledge mutation auto-confirmed',
        summary: `${action} was auto-confirmed because Browser QA full access is explicitly enabled.`,
        raw: { action, spaceId, relativePath },
      });
      return true;
    }
    if (!owner) return false;
  }
  const owner = BrowserWindow.getFocusedWindow() ?? undefined;
  if (!owner) return false;
  const result = await dialog.showMessageBox(owner, {
    type: 'warning',
    buttons: ['Allow once', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Confirm knowledge change',
    message: action === 'knowledge.write' ? 'Save this knowledge card?' : 'Promote or change this knowledge card?',
    detail: `${spaceId} / ${relativePath}. The action is authorized by the native main-process dialog.`,
    noLink: true,
  });
  return result.response === 0;
}

function consumeKnowledgeToken(
  token: string,
  action: 'knowledge.write' | 'knowledge.promote',
  spaceId: string,
  relativePath: string,
): void {
  const consumed = ipcApprovalTokenService.consume({
    token,
    action,
    ...knowledgeTokenBinding(spaceId, relativePath),
  });
  if (!consumed) {
    const error = new Error('KNOWLEDGE_APPROVAL_TOKEN_INVALID');
    (error as Error & { code: string }).code = 'KNOWLEDGE_APPROVAL_TOKEN_INVALID';
    throw error;
  }
}

function toIndexOverview(): KnowledgeIndexOverview | null {
  const snapshot = knowledgeIndexService.getSnapshot();
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
  asOf?: number;
  lanes?: KnowledgeQueryRequest['lanes'];
}): KnowledgeQueryRequest {
  return {
    ...(input.spaceIds ? { spaceIds: input.spaceIds } : {}),
    ...(input.text ? { text: input.text } : {}),
    ...(input.cardId ? { cardId: input.cardId } : {}),
    ...(input.relativePath ? { relativePath: input.relativePath } : {}),
    ...(input.type ? { type: input.type } : {}),
    ...(input.lifecycle ? { lifecycle: input.lifecycle } : {}),
    ...(input.relationTargetCardId ? { relationTargetCardId: input.relationTargetCardId } : {}),
    ...(input.asOf != null ? { asOf: input.asOf } : {}),
    ...(input.lanes ? { lanes: input.lanes } : {}),
  };
}

function rethrowKnowledgeError(error: unknown): never {
  if (error && typeof error === 'object' && 'code' in error) {
    throw error;
  }
  throw error;
}

export function registerKnowledgeHandlers(_context: WorkbenchIpcContext): void {
  ipcMain.handle('knowledge:overview', async (_event, ...rawArgs: unknown[]) => {
    parseIpcArgs(KnowledgeOverviewArgsSchema, rawArgs, { label: 'knowledge:overview', maxBytes: 1024 });
    return {
      spaces: knowledgeQueryService.listSpaces(),
      index: toIndexOverview(),
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
    parseIpcArgs(KnowledgeIndexRebuildArgsSchema, rawArgs, {
      label: 'knowledge:index:rebuild',
      maxBytes: 1024,
    });
    try {
      const snapshot = await knowledgeIndexService.rebuild();
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
    return {
      candidates: await knowledgeCandidateService.listCandidates(sessionId),
      drafts: await knowledgeCandidateService.listStagedDrafts(sessionId),
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

  ipcMain.handle('knowledge:coldDataImport', async (_event, ...rawArgs: unknown[]) => {
    const [input] = parseIpcArgs(KnowledgeColdDataImportArgsSchema, rawArgs, {
      label: 'knowledge:coldDataImport',
      maxBytes: COLD_DATA_MAX_BYTES + 8 * 1024,
    });
    try {
      if (input.spaceId) assertKnownSpaces([input.spaceId]);
      if (input.filePath) {
        return await knowledgeCandidateService.ingestColdDataPathToStaging(input.filePath, {
          sessionId: input.sessionId,
          ...(input.spaceId ? { spaceId: input.spaceId } : {}),
        });
      }
      return await knowledgeCandidateService.ingestColdDataToStaging(input.source ?? '', {
        sessionId: input.sessionId,
        ...(input.spaceId ? { spaceId: input.spaceId } : {}),
      });
    } catch (error) {
      rethrowKnowledgeError(error);
    }
  });

  ipcMain.handle('knowledge:issueApprovalToken', async (_event, ...rawArgs: unknown[]) => {
    try {
      const [input] = parseIpcArgs(KnowledgeIssueApprovalTokenArgsSchema, rawArgs, {
        label: 'knowledge:issueApprovalToken',
        maxBytes: 8 * 1024,
      });
      assertKnownSpaces([input.spaceId]);
      const confirmed = await confirmKnowledgeMutation(input.action, input.spaceId, input.relativePath);
      if (!confirmed) {
        return { error: 'Knowledge mutation was not confirmed by the main-process dialog.' };
      }
      const space = knowledgeQueryService.listSpaces().find((entry) => entry.spaceId === input.spaceId);
      return {
        token: ipcApprovalTokenService.issue({
          action: input.action,
          ...knowledgeSpaceTokenBinding(space, input.relativePath),
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
      consumeKnowledgeToken(input.approvalToken, 'knowledge.write', input.spaceId, input.card.relativePath);
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
    try {
      const spaceIds = input.scope === 'space'
        ? [input.spaceId].filter((value): value is string => Boolean(value))
        : (input.cardRefs ?? []).map((ref) => ref.spaceId);
      assertKnownSpaces([...new Set(spaceIds)]);
      return await knowledgeExportService.export(input);
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
      consumeKnowledgeToken(input.approvalToken, 'knowledge.promote', input.spaceId, input.card.relativePath);
      return {
        card: await knowledgeWriteService.promote(input),
      };
    } catch (error) {
      rethrowKnowledgeError(error);
    }
  });
}
