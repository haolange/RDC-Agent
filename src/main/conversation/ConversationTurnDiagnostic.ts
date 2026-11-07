import type { ConversationMessageDiagnostic } from '@shared/types/conversation';
import { SessionArtifactError } from '@shared/types/sessionArtifact';
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
      userMessage: `本次调查尚未完成：缺少可核对的调查记录或最终报告。已保留现有记录，请补齐材料或继续调查。`,
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
        ? error.noProgressReason === 'approved-obligation'
          ? `${label} 在收到未完成条件后没有继续处理或声明实际阻塞，本次执行已停止。现有结果已保留，请补齐缺口或继续处理。`
          : `${label} 连续三轮执行了相同的工具、参数并得到相同结果。本次 Agent Loop 已停止，以免继续无效消耗。请调整任务或改用具备所需工具的 Agent 后重试。`
        : `${label} 在 ${error.maxTurns ?? error.turn} 轮上限内仍需要继续调用工具。本次 Agent Loop 已停止；请缩小任务范围或调整 Agent 的轮次策略后重试。`,
      providerId: route.providerId,
      modelId: route.modelId,
      technicalMessage: redactTechnicalMessage(error),
    });
  }
  if (isStreamProtocolTurnFailure(error)) {
    const streamCode = error instanceof AgentRecoveryAbortError
      ? error.streamCode
      : typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : undefined;
    const streamLabel = streamCode ? `（${streamCode}）` : '';
    return createConversationDiagnostic({
      agentId: route.agentId,
      code: 'CONVERSATION_PROVIDER_STREAM_PROTOCOL_VIOLATION',
      severity: 'error',
      userMessage: `${label} 当前使用 ${route.providerId}/${route.modelId} 时，本地流式协议完整性校验失败${streamLabel}。这是客户端对流式输出分段的完整性故障，与账号、额度或网络无关。请将技术详情提供给开发者。`,
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
      userMessage: '本地会话产物配额已满，当前操作未能完成。原始会话与已写入证据仍保留；清理可证明冗余的产物或调整受控配额后继续。',
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
      userMessage: `本地上下文制品处理失败（${compactionFailure.code}）。原始会话和证据已保留；修复本地制品保存或读取问题后可继续调查。`,
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
      userMessage: `本地调查记录无法建立上下文检查点（${compactionFailure.code}）。原始会话和调查证据已保留；修复记录读取问题后可继续。`,
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
      userMessage: `本地上下文检查点未能建立（${compactionCode}）。原始会话和调查证据已保留；修复此错误后可继续调查。`,
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
      userMessage: '模型已给出终答，但本回合仍有未结算的直接 Task。运行时已将其标为受阻并保留证据；请查看 Task 状态，明确完成或受阻原因后继续。',
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
        ? `${label} 当前模型不接受图片附件。请更换支持视觉输入的模型后重试。`
        : `附件未能用于本次请求（${attachmentCode}）。请移除无效附件后重试。`,
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
  const route = `${providerId}/${modelId}`;
  switch (failure.kind) {
    case 'auth':
      return `${label} 当前使用 ${route} 时认证或权限失败。请检查该账号的 API Key、登录状态或模型访问权限后重试。`;
    case 'quota':
      return `${label} 当前使用 ${route} 时额度不足或触发了限流。请检查该账号额度、账单或稍后重试。`;
    case 'overloaded':
      return `${label} 当前使用 ${route} 时服务商过载或容量不足。请稍后重试；若持续出现，可改用更高服务等级或更换模型。`;
    case 'server':
      return `${label} 当前使用 ${route} 时服务商返回了服务端错误${failure.status ? `（HTTP ${failure.status}）` : ''}。请稍后重试。`;
    case 'empty_stream':
      return `${label} 当前使用 ${route} 时，服务商没有返回助手正文或结构化工具调用。请稍后重试；若持续出现，请检查该模型或更换模型。`;
    case 'network':
      return `${label} 当前使用 ${route} 时网络连接失败。请检查网络、代理或服务商可达性后重试。`;
    case 'request':
      return `${label} 当前使用 ${route} 时，服务商拒绝了本次请求的工具或参数格式。请更换模型或稍后重试；若持续出现，该路由的工具 schema 需要修正。`;
    case 'model':
      return `${label} 当前使用 ${route} 时，该账号没有此模型或模型已下线。请在设置中更换可用模型后重试。`;
    default:
      return `模型请求失败：${label} 当前使用 ${route}，但服务商请求没有成功。请检查该账号、模型权限、额度或网络状态后重试。`;
  }
}

function formatLlmFailureTechnicalMessage(failure: LlmRequestFailure): string {
  const snippet = redactRecoverySnippet(failure.snippet);
  return `provider HTTP ${failure.status ?? 'n/a'} · attempts ${failure.attempts}/${failure.maxAttempts} · ${snippet}`;
}
