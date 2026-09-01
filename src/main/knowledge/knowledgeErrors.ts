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

export class KnowledgeSemanticLaneClosedError extends Error {
  readonly code = 'KNOWLEDGE_SEMANTIC_LANE_CLOSED';
  constructor(availability: 'unavailable' | 'stale', reason: string) {
    super(`KNOWLEDGE_SEMANTIC_LANE_CLOSED: semantic lane is ${availability} (${reason}); retrieval is fail-closed.`);
    this.name = 'KnowledgeSemanticLaneClosedError';
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
