import { AppError } from '@shared/errors/appError';
import type { AgentPermissionMode } from '@shared/types/settings';

export function knowledgeHumanConfirmationRequired(permissionMode: AgentPermissionMode): AppError {
  return new AppError(
    'KNOWLEDGE_HUMAN_CONFIRMATION_REQUIRED',
    `persistent Knowledge writes need explicit human confirmation; ${permissionMode} cannot bypass.`,
    { params: { permissionMode } },
  );
}

export function knowledgeCandidateRequiresIntent(): AppError {
  return new AppError('KNOWLEDGE_CANDIDATE_REQUIRES_INTENT', 'Session Candidate requires explicit user intent.');
}

export function knowledgeAssetsMissing(): AppError {
  return new AppError(
    'KNOWLEDGE_ASSETS_MISSING',
    'all declared Knowledge images must be available in their owning space before creating or verifying a card.',
  );
}

/** Draft cards whose migration would overwrite a different card; callers list them for the user to resolve. */
export class KnowledgeDraftMigrationConflictError extends AppError {
  constructor(readonly cardIds: string[]) {
    super('KNOWLEDGE_DRAFT_MIGRATION_CONFLICT', cardIds.join(','), { params: { cards: cardIds.length } });
    this.name = 'KnowledgeDraftMigrationConflictError';
  }
}
