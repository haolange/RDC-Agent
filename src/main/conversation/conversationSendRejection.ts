import type {
  ConversationPreflightErrorCode,
  ConversationSendResult,
} from '@shared/types/conversation';

const PREFLIGHT_ERROR_CODES = new Set<ConversationPreflightErrorCode>([
  'REQUEST_CANCELLED',
  'CONVERSATION_BUSY',
  'AGENT_COMMIT_NOT_FOUND',
  'AGENT_PROFILE_UNAVAILABLE',
  'PROVIDER_UNAVAILABLE',
  'MODEL_UNAVAILABLE',
  'NO_USABLE_CONTEXT_TIER',
  'PLAN_CONFLICT',
  'CONSTRAINT_REJECTED',
  'ATTACHMENT_INVALID',
  'ATTACHMENT_LIMIT_EXCEEDED',
  'ATTACHMENT_MEDIA_UNSUPPORTED',
  'ATTACHMENT_NOT_FOUND',
  'VISION_INPUT_UNSUPPORTED',
  'PROMPT_PLAN_UNAVAILABLE',
  'PROMPT_OVERHEAD_EXCEEDS_BUDGET',
  'CONTEXT_CANNOT_FIT',
  'TURN_COMMIT_FAILED',
  'PREFLIGHT_FAILED',
]);

export function toRejectedSendResult(requestId: string, error: unknown): ConversationSendResult {
  const technicalMessage = error instanceof Error ? error.message : String(error);
  const matchedCode = technicalMessage.match(/^([A-Z][A-Z0-9_]+):\s*/u)?.[1];
  const code = matchedCode && PREFLIGHT_ERROR_CODES.has(matchedCode as ConversationPreflightErrorCode)
    ? matchedCode as ConversationPreflightErrorCode
    : 'PREFLIGHT_FAILED';
  const message = technicalMessage.replace(/^([A-Z][A-Z0-9_]+):\s*/u, '').trim()
    || 'The request could not be prepared.';
  return {
    status: 'rejected',
    requestId,
    phase: code === 'TURN_COMMIT_FAILED' ? 'commit' : 'preflight',
    error: {
      code,
      message,
      technicalMessage,
      retryable: code === 'REQUEST_CANCELLED'
        || code === 'CONVERSATION_BUSY'
        || code === 'PROVIDER_UNAVAILABLE'
        || code === 'PREFLIGHT_FAILED',
    },
  };
}
