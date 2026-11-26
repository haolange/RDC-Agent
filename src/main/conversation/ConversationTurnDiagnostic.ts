import { SessionArtifactError } from '../sessions/artifacts/sessionArtifactContract';
import {
  AgentRecoveryAbortError,
  findProviderHttpError,
  isProviderStreamProtocolError,
  redactRecoverySnippet,
  type ErrorCategory,
} from '../agent-runtime/agent/ErrorRecovery';
import {
  isProviderEmptyStreamError,
  isProviderWireFailureError,
  ProviderTimeoutError,
} from '../agent-runtime/providers/internal/http';
import { AgentLoopTerminationError } from '../agent-runtime/agent/LoopProgressGuard';
import { isMissionCompletionError } from '../investigation/missionCompletionContract';
import { InvestigationError } from '../investigation/investigationErrors';
import {
  createConversationDiagnostic,
  getAgentLabel,
  redactTechnicalMessage,
  type AgentRoutePreflightOk,
} from './ConversationRoutePreflight';
import { diagnosticText } from './diagnosticText';
import type { ConversationMessageDiagnostic } from '@shared/types/conversation';

export function createTurnFailedDiagnostic(
  route: Pick<AgentRoutePreflightOk, 'agentId' | 'providerId' | 'modelId'>,
  error: unknown,
): ConversationMessageDiagnostic {
  const label = getAgentLabel(route.agentId);
  if (isMissionCompletionError(error)) {
    return createConversationDiagnostic({
      agentId: route.agentId,
      code: 'MISSION_COMPLETION_DENIED',
      severity: 'error',
      userMessage: diagnosticText('missionIncomplete'),
      providerId: route.providerId,
      modelId: route.modelId,
      technicalMessage: redactTechnicalMessage(error),
    });
  }
  if (error instanceof AgentLoopTerminationError) {
    const isNoProgress = error.code === 'AGENT_NO_PROGRESS';
    return createConversationDiagnostic({
      agentId: route.agentId,
      code: isNoProgress
        ? 'CONVERSATION_AGENT_LOOP_STALLED'
        : 'CONVERSATION_AGENT_TURN_LIMIT_EXCEEDED',
      severity: 'error',
      userMessage: isNoProgress
        ? diagnosticText(error.noProgressReason === 'runtime-obligation' ? 'loopObligationIgnored' : 'loopRepeated', { agent: label })
        : diagnosticText('loopTurnLimit', { agent: label, turns: error.maxTurns ?? error.turn }),
      providerId: route.providerId,
      modelId: route.modelId,
      technicalMessage: redactTechnicalMessage(error),
    });
  }
  if (isStreamProtocolTurnFailure(error)) {
    return createConversationDiagnostic({
      agentId: route.agentId,
      code: 'CONVERSATION_PROVIDER_STREAM_PROTOCOL_VIOLATION',
      severity: 'error',
      userMessage: diagnosticText('streamIntegrity', { agent: label, model: route.modelId }),
      providerId: route.providerId,
      modelId: route.modelId,
      technicalMessage: redactTechnicalMessage(error),
    });
  }
  const compactionFailure = error instanceof AgentRecoveryAbortError ? error.cause : error;
  if (compactionFailure instanceof SessionArtifactError && compactionFailure.code === 'ARTIFACT_QUOTA_EXCEEDED') {
    return createConversationDiagnostic({
      agentId: route.agentId,
      code: 'CONVERSATION_ARTIFACT_QUOTA_EXCEEDED',
      severity: 'error',
      userMessage: diagnosticText('artifactQuota'),
      providerId: route.providerId,
      modelId: route.modelId,
      technicalMessage: redactTechnicalMessage(compactionFailure),
    });
  }
  if (error instanceof AgentRecoveryAbortError && compactionFailure instanceof SessionArtifactError) {
    return createConversationDiagnostic({
      agentId: route.agentId,
      code: 'CONVERSATION_CONTEXT_COMPACTION_FAILED',
      severity: 'error',
      userMessage: diagnosticText('artifactFailed'),
      providerId: route.providerId,
      modelId: route.modelId,
      technicalMessage: redactTechnicalMessage(compactionFailure),
    });
  }
  if (error instanceof AgentRecoveryAbortError && compactionFailure instanceof InvestigationError) {
    return createConversationDiagnostic({
      agentId: route.agentId,
      code: 'CONVERSATION_CONTEXT_COMPACTION_FAILED',
      severity: 'error',
      userMessage: diagnosticText('checkpointRecordFailed'),
      providerId: route.providerId,
      modelId: route.modelId,
      technicalMessage: redactTechnicalMessage(compactionFailure),
    });
  }
  const compactionCode = compactionFailure instanceof Error && compactionFailure.name === 'Error'
    ? compactionFailure.message.match(/^(COMPACTION_[A-Z_]+):/u)?.[1]
    : undefined;
  if (compactionCode) {
    return createConversationDiagnostic({
      agentId: route.agentId,
      code: 'CONVERSATION_CONTEXT_COMPACTION_FAILED',
      severity: 'error',
      userMessage: diagnosticText('checkpointFailed'),
      providerId: route.providerId,
      modelId: route.modelId,
      technicalMessage: redactTechnicalMessage(compactionFailure),
    });
  }
  const technicalMessage = redactTechnicalMessage(error);
  const matchedCode = technicalMessage.match(/^([A-Z][A-Z0-9_]+):/u)?.[1];
  if (matchedCode === 'TASK_COMPLETION_DENIED') {
    return createConversationDiagnostic({
      agentId: route.agentId,
      code: 'CONVERSATION_TASK_COMPLETION_DENIED',
      severity: 'error',
      userMessage: diagnosticText('taskUnsettled'),
      providerId: route.providerId,
      modelId: route.modelId,
      technicalMessage,
    });
  }
  const attachmentCode = matchedCode === 'ATTACHMENT_LIMIT_EXCEEDED'
    || matchedCode === 'ATTACHMENT_MEDIA_UNSUPPORTED'
    || matchedCode === 'ATTACHMENT_NOT_FOUND'
    || matchedCode === 'ATTACHMENT_INVALID'
    || matchedCode === 'VISION_INPUT_UNSUPPORTED'
    ? matchedCode
    : null;
  if (attachmentCode) {
    return createConversationDiagnostic({
      agentId: route.agentId,
      code: attachmentCode,
      severity: 'error',
      userMessage: attachmentCode === 'VISION_INPUT_UNSUPPORTED'
        ? diagnosticText('imageUnsupported', { agent: label })
        : diagnosticText('attachmentRejected'),
      providerId: route.providerId,
      modelId: route.modelId,
      technicalMessage,
    });
  }
  const failure = classifyLlmRequestFailure(error);
  return createConversationDiagnostic({
    agentId: route.agentId,
    code: 'CONVERSATION_LLM_REQUEST_FAILED',
    severity: 'error',
    userMessage: llmRequestFailureUserMessage(label, route.providerId, route.modelId, failure),
    providerId: route.providerId,
    modelId: route.modelId,
    technicalMessage: formatLlmFailureTechnicalMessage(failure),
  });
}

function isStreamProtocolTurnFailure(error: unknown): boolean {
  if (isProviderStreamProtocolError(error)) {
    return true;
  }
  return error instanceof AgentRecoveryAbortError && error.category === 'stream_protocol';
}

type LlmFailureClass = 'auth' | 'quota' | 'overloaded' | 'server' | 'empty_stream' | 'network' | 'request' | 'model' | 'generic';

interface LlmRequestFailure {
  kind: LlmFailureClass;
  status?: number;
  attempts: number;
  maxAttempts: number;
  snippet: string;
}

function classifyLlmRequestFailure(error: unknown): LlmRequestFailure {
  const abort = error instanceof AgentRecoveryAbortError ? error : undefined;
  const http = findProviderHttpError(error);
  const status = abort?.lastStatus ?? http?.status ?? extractStatusFromMessage(error);
  const attempts = abort?.attempts ?? 1;
  const maxAttempts = abort?.maxAttempts ?? 1;
  const snippetSource = abort?.bodySnippet
    ?? http?.bodyText
    ?? causeSnippet(error);
  const snippet = redactTechnicalMessage(snippetSource);
  const category = abort?.category ?? inferLlmFailureCategory(error, status);
  const kind = llmFailureKind(category, status, error);
  return { kind, status, attempts, maxAttempts, snippet };
}

function causeSnippet(error: unknown): string {
  if (isProviderEmptyStreamError(error)) {
    return error.message;
  }
  if (isProviderWireFailureError(error)) {
    return error.bodyText ?? error.message;
  }
  if (error instanceof Error && error.cause instanceof Error) {
    if (isProviderEmptyStreamError(error.cause)) {
      return error.cause.message;
    }
    if (isProviderWireFailureError(error.cause)) {
      return error.cause.bodyText ?? error.cause.message;
    }
    return error.cause.message;
  }
  return error instanceof Error ? error.message : String(error);
}

function inferLlmFailureCategory(error: unknown, status: number | undefined): ErrorCategory | undefined {
  if (isProviderEmptyStreamError(error)) {
    return 'empty_stream';
  }
  if (error instanceof ProviderTimeoutError) {
    return 'network_error';
  }
  if (status === 401 || status === 403) {
    return 'auth_error';
  }
  if (status === 429 || status === 402) {
    return 'rate_limit';
  }
  if (status === 529 || status === 503) {
    return 'overloaded';
  }
  if (typeof status === 'number' && status >= 500) {
    return 'server_error';
  }
  const wire = isProviderWireFailureError(error) ? error : undefined;
  const raw = `${error instanceof Error ? `${error.message} ${error.name}` : String(error)} ${wire?.bodyText ?? ''}`.toLowerCase();
  if (raw.includes('quota') || raw.includes('rate_limit') || (raw.includes('rate') && raw.includes('limit'))) {
    return 'rate_limit';
  }
  if (
    raw.includes('overloaded')
    || raw.includes('service unavailable')
    || raw.includes('at capacity')
    || raw.includes('high demand')
  ) {
    return 'overloaded';
  }
  if (
    raw.includes('econnrefused')
    || raw.includes('econnreset')
    || raw.includes('etimedout')
    || raw.includes('enotfound')
    || raw.includes('timeout')
    || raw.includes('socket')
    || raw.includes('network')
  ) {
    return 'network_error';
  }
  return undefined;
}

function llmFailureKind(
  category: ErrorCategory | undefined,
  status: number | undefined,
  error: unknown,
): LlmFailureClass {
  if (category === 'empty_stream' || isProviderEmptyStreamError(error)) {
    return 'empty_stream';
  }
  if (category === 'auth_error' || status === 401 || status === 403) {
    return 'auth';
  }
  if (category === 'rate_limit' || status === 429 || status === 402) {
    return 'quota';
  }
  if (category === 'overloaded') {
    return 'overloaded';
  }
  if (category === 'server_error') {
    return 'server';
  }
  if (status === 529 || status === 503) {
    return 'overloaded';
  }
  if (typeof status === 'number' && status >= 500) {
    return 'server';
  }
  if (category === 'network_error') {
    return 'network';
  }
  if (isModelUnavailableFailure(status, error)) {
    return 'model';
  }
  if (isRequestSchemaFailure(status, error)) {
    return 'request';
  }
  return 'generic';
}

function failureText(error: unknown): string {
  const abort = error instanceof AgentRecoveryAbortError ? error : undefined;
  return `${error instanceof Error ? `${error.message} ${error.name}` : String(error)} ${causeSnippet(error)} ${abort?.bodySnippet ?? ''}`.toLowerCase();
}

function isRequestSchemaFailure(status: number | undefined, error: unknown): boolean {
  const raw = failureText(error);
  return raw.includes('invalid-argument')
    || raw.includes('tool parameter')
    || raw.includes('root schema')
    || raw.includes('oneof')
    || raw.includes('anyof')
    || raw.includes('missingsessionid')
    || raw.includes('x-opencode-session')
    || raw.includes('input must be a list')
    || raw.includes('stream must be set')
    || (status === 400 && (raw.includes('invalid request') || raw.includes('unsupported parameter')));
}

function isModelUnavailableFailure(status: number | undefined, error: unknown): boolean {
  const raw = failureText(error);
  return status === 404
    || raw.includes('model_not_found')
    || raw.includes('model not found')
    || raw.includes('unknown model')
    || raw.includes('does not have access to model');
}

function extractStatusFromMessage(error: unknown): number | undefined {
  const raw = error instanceof Error ? error.message : String(error);
  const match = raw.match(/\b(4\d{2}|5\d{2})\b/);
  if (!match) {
    return undefined;
  }
  const code = Number(match[1]);
  return Number.isNaN(code) ? undefined : code;
}

function llmRequestFailureUserMessage(
  label: string,
  providerId: string,
  modelId: string,
  failure: LlmRequestFailure,
): string {
  const params = { agent: label, model: modelId, provider: providerId };
  switch (failure.kind) {
    case 'auth': return diagnosticText('requestAuth', params);
    case 'quota': return diagnosticText('requestQuota', params);
    case 'overloaded': return diagnosticText('requestOverloaded', params);
    case 'server': return diagnosticText('requestServer', params);
    case 'empty_stream': return diagnosticText('requestEmpty', params);
    case 'network': return diagnosticText('requestNetwork', params);
    case 'request': return diagnosticText('requestRejected', params);
    case 'model': return diagnosticText('requestModelMissing', params);
    default: return diagnosticText('requestFailed', params);
  }
}

function formatLlmFailureTechnicalMessage(failure: LlmRequestFailure): string {
  const snippet = redactRecoverySnippet(failure.snippet);
  return `provider HTTP ${failure.status ?? 'n/a'} · attempts ${failure.attempts}/${failure.maxAttempts} · ${snippet}`;
}
