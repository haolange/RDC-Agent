import type { AgentPermissionMode } from '@shared/types/settings';

export class KnowledgeHumanConfirmationRequiredError extends Error {
  readonly code = 'KNOWLEDGE_HUMAN_CONFIRMATION_REQUIRED';
  readonly permissionMode: AgentPermissionMode;
  constructor(permissionMode: AgentPermissionMode) {
    super(
      `KNOWLEDGE_HUMAN_CONFIRMATION_REQUIRED: persistent Knowledge writes need explicit human confirmation; ${permissionMode} cannot bypass.`,
    );
    this.name = 'KnowledgeHumanConfirmationRequiredError';
    this.permissionMode = permissionMode;
  }
}

export class KnowledgeCandidateRequiresIntentError extends Error {
  readonly code = 'KNOWLEDGE_CANDIDATE_REQUIRES_INTENT';
  constructor() {
    super('KNOWLEDGE_CANDIDATE_REQUIRES_INTENT: Session Candidate requires explicit user intent.');
    this.name = 'KnowledgeCandidateRequiresIntentError';
  }
}

export class KnowledgeLifecycleError extends Error {
  readonly code = 'KNOWLEDGE_LIFECYCLE_INVALID';
  constructor(message: string) {
    super(message);
    this.name = 'KnowledgeLifecycleError';
  }
}

export class KnowledgeRevisionConflictError extends Error {
  readonly code = 'KNOWLEDGE_REVISION_CONFLICT';
  constructor(detail: string) {
    super(`KNOWLEDGE_REVISION_CONFLICT: ${detail}`);
    this.name = 'KnowledgeRevisionConflictError';
  }
}

export class KnowledgeWritePathError extends Error {
  readonly code = 'KNOWLEDGE_WRITE_PATH_REJECTED';
  constructor(detail: string) {
    super(`KNOWLEDGE_WRITE_PATH_REJECTED: ${detail}`);
    this.name = 'KnowledgeWritePathError';
  }
}

export class KnowledgeWriteIntegrityError extends Error {
  readonly code = 'KNOWLEDGE_WRITE_INTEGRITY';
  constructor(detail: string) {
    super(`KNOWLEDGE_WRITE_INTEGRITY: ${detail}`);
    this.name = 'KnowledgeWriteIntegrityError';
  }
}

export class KnowledgeApprovalTokenInvalidError extends Error {
  readonly code = 'KNOWLEDGE_APPROVAL_TOKEN_INVALID';
  constructor() {
    super('KNOWLEDGE_APPROVAL_TOKEN_INVALID: approvalToken is missing, already consumed, or does not match.');
    this.name = 'KnowledgeApprovalTokenInvalidError';
  }
}

export class KnowledgeDraftMigrationConflictError extends Error {
  readonly code = 'KNOWLEDGE_DRAFT_MIGRATION_CONFLICT';
  readonly cardIds: string[];
  constructor(cardIds: string[]) {
    super(`KNOWLEDGE_DRAFT_MIGRATION_CONFLICT: ${cardIds.join(',')}`);
    this.name = 'KnowledgeDraftMigrationConflictError';
    this.cardIds = cardIds;
  }
}
