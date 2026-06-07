import fs from 'fs';
import path from 'path';
import type {
  ConversationAttachmentInput,
  ConversationCancelActiveTurnRequest,
  ConversationCancelActiveTurnResult,
  ConversationControl,
  ConversationMessage,
  ConversationMessageDiagnostic,
  ConversationToolCall,
  ConversationReasoningStep,
  ConversationReasoningTrace,
  ConversationSendRequest,
  ConversationStreamEvent,
  ConversationTurnResult,
} from '@shared/types/conversation';
import type { AgentRole } from '@shared/types/agent';
import type {
  AppMode,
  CaptureDescriptor,
  OpenedCaptureState,
  ProjectInputRecord,
  RunSummary,
  SessionAttachmentRecord,
  SessionRecord,
} from '@shared/types/session';
import type { ReplayDeviceEntry } from '@shared/types/device';
import { generateEventId, nowMs } from '@shared/utils/id';
import type { AgentEvent } from '@shared/types/agentRuntime';
import { agentOrchestrator } from '../workflow/debugger/AgentOrchestrator';
import { traceService } from '../agent-trace/TraceService';
import { debuggerRuntime } from '../workflow/debugger/DebuggerRuntime';
import { replayDeviceService } from '../captures/ReplayDeviceService';
import { rdxSessionService } from '../index';
import { settingsService } from '../settings/SettingsService';
import { storageAdapter } from '../sessions/StorageAdapter';
import { workflowProjectionPublisher } from '../workflow/debugger/WorkflowProjectionPublisher';
import { runtimeLogService } from '../runtime/RuntimeLogService';

interface ConversationContextInput extends ConversationSendRequest {
  fallbackProjectId?: string | null;
  fallbackSessionId?: string | null;
  fallbackRunId?: string | null;
}

interface ResolvedConversationContext {
  projectId: string | null;
  session: SessionRecord | null;
  currentRun: RunSummary | null;
  projectInputs: ProjectInputRecord[];
  openedCapture: OpenedCaptureState | null;
  openedCapturePath: string | null;
  replayDevice: ReplayDeviceEntry | null;
}

interface ActiveConversationTurn {
  turnId: string;
  sessionId: string | null;
  startedAt: number;
  abortController: AbortController;
  stop: () => void;
}

const EXECUTE_PATTERN = /开始|启动|执行|正式分析|正式调试|本地调试|local\s*模式调试|模式调试|直接分析|现在分析|run\b|start\b|debug\b|analy[sz]e\b|帮我调试|请.*调试|开始调试|开始分析/i;
const TASK_FILE_PATTERN = /([A-Za-z]:[\\/][^\r\n"]+\.(txt|md))/i;
const CONTROL_OPEN_TAG = '<control>';

const ACTIVE_RUN_STATUSES: Array<RunSummary['status']> = [
  'planning',
  'awaiting_input',
  'awaiting_approval',
  'queued',
  'running',
  'stopping',
];

function isActiveRun(run: RunSummary | null | undefined): run is RunSummary {
  return Boolean(run && ACTIVE_RUN_STATUSES.includes(run.status));
}

function trimPathLabel(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || value;
}

function createReasoningStep(id: string, title: string, stage?: string): ConversationReasoningStep {
  return {
    id,
    title,
    stage,
    status: 'pending',
    toolCalls: [],
    startedAt: nowMs(),
  };
}

function createDraftReasoningTrace(summary: string, steps: ConversationReasoningStep[]): ConversationReasoningTrace {
  return {
    status: 'running',
    summary,
    steps,
    updatedAt: nowMs(),
  };
}

function cloneTrace(trace: ConversationReasoningTrace | null | undefined): ConversationReasoningTrace {
  return trace
    ? {
        ...trace,
        steps: trace.steps.map((step) => ({
          ...step,
          toolCalls: step.toolCalls.map((toolCall) => ({ ...toolCall })),
        })),
      }
    : {
        status: 'idle',
        steps: [],
        updatedAt: nowMs(),
      };
}

function upsertTraceStep(
  trace: ConversationReasoningTrace | null | undefined,
  stepId: string,
  patch: Partial<ConversationReasoningStep>,
): ConversationReasoningTrace {
  const nextTrace = cloneTrace(trace);
  const stepIndex = nextTrace.steps.findIndex((step) => step.id === stepId);
  if (stepIndex >= 0) {
    nextTrace.steps[stepIndex] = {
      ...nextTrace.steps[stepIndex],
      ...patch,
      toolCalls: patch.toolCalls
        ? patch.toolCalls.map((toolCall) => ({ ...toolCall }))
        : nextTrace.steps[stepIndex].toolCalls.map((toolCall) => ({ ...toolCall })),
    };
  } else {
    nextTrace.steps.push({
      ...createReasoningStep(stepId, patch.title || stepId, patch.stage),
      ...patch,
      toolCalls: patch.toolCalls ? patch.toolCalls.map((toolCall) => ({ ...toolCall })) : [],
    });
  }
  nextTrace.updatedAt = nowMs();
  return nextTrace;
}

function finalizeTrace(
  trace: ConversationReasoningTrace | null | undefined,
  status: ConversationReasoningTrace['status'],
  summary?: string,
): ConversationReasoningTrace {
  const nextTrace = cloneTrace(trace);
  nextTrace.status = status;
  nextTrace.summary = summary ?? nextTrace.summary;
  nextTrace.updatedAt = nowMs();
  return nextTrace;
}

function upsertRuntimeToolCall(
  trace: ConversationReasoningTrace | null | undefined,
  patch: Partial<ConversationToolCall> & { id: string; toolName: string },
): ConversationReasoningTrace {
  const nextTrace = cloneTrace(trace);
  const stepId = 'runtime-tools';
  let step = nextTrace.steps.find((entry) => entry.id === stepId);
  if (!step) {
    step = createReasoningStep(stepId, 'Runtime tool trace', 'cowork');
    step.status = 'running';
    nextTrace.steps.push(step);
  }
  const toolIndex = step.toolCalls.findIndex((toolCall) => toolCall.id === patch.id);
  if (toolIndex >= 0) {
    step.toolCalls[toolIndex] = {
      ...step.toolCalls[toolIndex],
      ...patch,
    };
  } else {
    step.toolCalls.push({
      id: patch.id,
      toolName: patch.toolName,
      status: patch.status ?? 'pending',
      argsPreview: patch.argsPreview,
      resultPreview: patch.resultPreview,
      error: patch.error,
      startedAt: patch.startedAt ?? nowMs(),
      completedAt: patch.completedAt,
    });
  }
  if (step.toolCalls.length > 0 && step.toolCalls.every((toolCall) => toolCall.status === 'complete' || toolCall.status === 'error')) {
    step.status = step.toolCalls.some((toolCall) => toolCall.status === 'error') ? 'error' : 'complete';
    step.completedAt = nowMs();
  }
  nextTrace.status = 'running';
  nextTrace.updatedAt = nowMs();
  return nextTrace;
}

function makeConversationMessage(
  role: ConversationMessage['role'],
  content: string,
  options: {
    turnId: string;
    sessionId?: string | null;
    projectId?: string | null;
    runId?: string | null;
    modeContext?: AppMode;
    agentId?: ConversationMessage['agentId'];
    attachments?: SessionAttachmentRecord[];
    status?: ConversationMessage['status'];
    reasoningTrace?: ConversationReasoningTrace | null;
    diagnostic?: ConversationMessage['diagnostic'];
  },
): ConversationMessage {
  const createdAt = nowMs();
  return {
    id: generateEventId(role === 'user' ? 'msgu' : role === 'assistant' ? 'msga' : 'msgs'),
    turnId: options.turnId,
    sessionId: options.sessionId ?? null,
    projectId: options.projectId ?? null,
    runId: options.runId ?? null,
    modeContext: options.modeContext,
    role,
    agentId: options.agentId,
    content,
    status: options.status ?? (role === 'assistant' ? 'draft' : 'complete'),
    updatedAt: createdAt,
    reasoningTrace: options.reasoningTrace ?? null,
    diagnostic: options.diagnostic ?? null,
    attachments: options.attachments,
    createdAt,
  };
}

function composeMessageForAgent(entry: ConversationMessage): string {
  const attachmentLines = (entry.attachments ?? []).map((attachment) => `- ${attachment.fileName}`);
  if (attachmentLines.length === 0) {
    return entry.content;
  }

  const suffix = `\n\nAttached files:\n${attachmentLines.join('\n')}`;
  return entry.content ? `${entry.content}${suffix}` : `Attached files:\n${attachmentLines.join('\n')}`;
}

function stripControlBlock(text: string): string {
  return text.replace(/<control>\s*[\s\S]*?<\/control>/i, '').trim();
}

function parseControlBlock(text: string): ConversationControl | null {
  const match = text.match(/<control>\s*([\s\S]*?)\s*<\/control>/i);
  if (!match?.[1]) {
    return null;
  }

  try {
    const parsed = JSON.parse(match[1]) as Partial<ConversationControl>;
    const intent = parsed.intent;
    if (intent !== 'talk' && intent !== 'intake' && intent !== 'execute') {
      return null;
    }

    return {
      intent,
      safe_to_start: parsed.safe_to_start === true,
      needs_project: parsed.needs_project === true,
      needs_capture: parsed.needs_capture === true,
      needs_target_capture: parsed.needs_target_capture === true,
      needs_route: parsed.needs_route === true,
      reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
    };
  } catch {
    return null;
  }
}

function resolveTaskFileContext(message: string): {
  taskFilePath: string | null;
  taskFileContent: string | null;
  effectiveMessage: string;
} {
  const match = message.match(TASK_FILE_PATTERN);
  const taskFilePath = match?.[1] ? path.resolve(match[1]) : null;
  if (!taskFilePath || !fs.existsSync(taskFilePath) || !fs.statSync(taskFilePath).isFile()) {
    return {
      taskFilePath: null,
      taskFileContent: null,
      effectiveMessage: message,
    };
  }

  const taskFileContent = fs.readFileSync(taskFilePath, 'utf-8').trim();
  return {
    taskFilePath,
    taskFileContent,
    effectiveMessage: [message, taskFileContent].filter(Boolean).join('\n\n'),
  };
}

function buildCoworkPrompt(
  context: ResolvedConversationContext,
  history: ConversationMessage[],
  mode: AppMode,
  message: string,
  attachments: SessionAttachmentRecord[],
): string {
  const resolvedTaskFile = resolveTaskFileContext(message);
  const recentHistory = history.slice(-6).map((entry) => ({
    role: entry.role,
    content: entry.content,
  }));

  return JSON.stringify({
    requested_mode: mode,
    requested_mode_label: mode === 'ask'
      ? 'Ask'
      : mode === 'debugger'
      ? 'Debugger'
      : mode === 'analyzer'
        ? 'Analyzer'
        : 'Optimizer',
    user_message: message,
    effective_user_message: resolvedTaskFile.effectiveMessage,
    task_file_path: resolvedTaskFile.taskFilePath,
    task_file_content: resolvedTaskFile.taskFileContent,
    current_project_id: context.projectId,
    current_session_id: context.session?.sessionId ?? null,
    active_run_id: isActiveRun(context.currentRun) ? context.currentRun.runId : null,
    opened_capture: context.openedCapturePath,
    project_inputs: context.projectInputs.slice(0, 8).map((entry) => entry.fileName),
    incoming_attachments: attachments.map((entry) => ({
      file_name: entry.fileName,
      kind: entry.kind,
      mime_type: entry.mimeType,
    })),
    recent_history: recentHistory,
  }, null, 2);
}

function buildAskSystemPrompt(): string {
  return [
    '你是 RDC-Agent 的 Ask 助手，负责非执行对话。',
    '要求：',
    '1. 正常回答用户问题，语气简洁，不使用审批流、工单流或调试执行口吻。',
    '2. 不要自称 RDC Debugger，不要暗示已经开始 RenderDoc 调试，也不要假装分析过 capture。',
    '3. 可以解释能力边界、澄清目标、帮助用户判断是否需要 Open .rdc capture。',
    '4. 如果用户要求正式调试或执行分析，只提示需要在应用内 Open capture 并切换到 Debugger；Ask 模式不能创建 run。',
    '5. 不要声称可以调用 shell、rdx-tool、ToolBridge 或任何 RenderDoc 执行工具。',
    '6. 不需要输出隐藏控制块，除非明确需要表达 intake；即使输出 control，也必须 safe_to_start=false。',
  ].join('\n');
}

function buildDebuggerCoworkSystemPrompt(): string {
  return [
    '你是 RDC Debugger，一个面向 RenderDoc 调试场景的 Cowork Agent。',
    '要求：',
    '1. 始终先用自然中文正常回复用户，不要像审批流或工单流。',
    '2. 如果用户问通用知识、产品能力、技术概念，直接回答，不要强行转成调试执行，也不要在普通寒暄中自我介绍成 RDC Debugger。',
    '3. 没有正式进入调试 run 前，不要假装自己已经分析过 capture。',
    '4. Ask 是非执行入口；只有 requested_mode 是 Debugger、用户明确表达“现在开始正式调试/执行分析”，且应用内已有 opened_capture 时，才把 intent 标成 execute。',
    '5. 回复正文结束后，必须额外附加一个 <control>{...}</control> 块，control JSON 只允许包含 intent, safe_to_start, needs_project, needs_capture, needs_target_capture, needs_route, reason。',
    '6. 如果你不确定，就把 intent 设为 talk 或 intake，safe_to_start 设为 false。',
    '7. 控制块不要在正文里解释给用户。',
    '8. requested_mode 表示当前 UI 模式，Ask 只做澄清与引导，Debugger 偏重定位与排障，Analyzer 偏重拆解与证据整理，Optimizer 偏重瓶颈判断与优化建议；回答结构要随 mode 调整。',
  ].join('\n');
}

interface AgentRoutePreflightOk {
  ok: true;
  agentId: AgentRole;
  routeAgentId: AgentRole;
  providerId: string;
  modelId: string;
}

interface AgentRoutePreflightBlocked {
  ok: false;
  diagnostic: ConversationMessageDiagnostic;
}

type AgentRoutePreflight = AgentRoutePreflightOk | AgentRoutePreflightBlocked;

function redactTechnicalMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/(Bearer\s+)[^\s"'`,;)}]+/gi, '$1[redacted]')
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret)["'\s:=]+)[^"',;\s)}]+/gi, '$1[redacted]')
    .slice(0, 1200);
}

function createConversationDiagnostic(input: {
  agentId: AgentRole;
  code: ConversationMessageDiagnostic['code'];
  severity: ConversationMessageDiagnostic['severity'];
  userMessage: string;
  providerId?: string;
  modelId?: string;
  adapterId?: string;
  technicalMessage?: string;
}): ConversationMessageDiagnostic {
  return {
    code: input.code,
    severity: input.severity,
    userMessage: input.userMessage,
    agentId: input.agentId,
    providerId: input.providerId,
    modelId: input.modelId,
    adapterId: input.adapterId,
    technicalMessage: input.technicalMessage,
  };
}

function getConversationAgentLabel(agentId: AgentRole): string {
  return agentId === 'ask_agent' ? 'Ask' : 'rdc-debugger';
}

function resolveAgentRoutePreflight(agentId: AgentRole, fallbackAgentId?: AgentRole): AgentRoutePreflight {
  const settings = settingsService.getAll();
  const primaryRoute = settings.llm.agentRoutes.find((entry) => entry.agentId === agentId);
  const fallbackRoute = fallbackAgentId
    ? settings.llm.agentRoutes.find((entry) => entry.agentId === fallbackAgentId)
    : undefined;
  const route = primaryRoute?.providerId && primaryRoute.modelId ? primaryRoute : fallbackRoute;
  const routeAgentId = route?.agentId ?? agentId;
  const label = getConversationAgentLabel(agentId);
  if (!route?.providerId || !route.modelId) {
    return {
      ok: false,
      diagnostic: createConversationDiagnostic({
        agentId,
        code: 'CONVERSATION_LLM_ROUTE_MISSING',
        severity: 'warning',
        userMessage: `当前 ${label} 链路还没绑定可用模型。请在 Settings 中为 \`${agentId}\` 选择 provider 和 model route。`,
      }),
    };
  }

  const provider = settings.llm.providers.find((entry) => entry.id === route.providerId);
  if (!provider || !provider.enabled || !provider.isConfigured) {
    return {
      ok: false,
      diagnostic: createConversationDiagnostic({
        agentId,
        code: 'CONVERSATION_LLM_PROVIDER_UNAVAILABLE',
        severity: 'error',
        userMessage: `当前 ${label} 链路的 provider 不可用：${route.providerId}。请检查该服务商的连接状态、账号或密钥后重试。`,
        providerId: route.providerId,
        modelId: route.modelId,
        technicalMessage: provider?.lastError ?? provider?.unavailableReason,
      }),
    };
  }

  const model = provider.models.find((entry) => entry.id === route.modelId);
  if (!model?.enabled) {
    return {
      ok: false,
      diagnostic: createConversationDiagnostic({
        agentId,
        code: 'CONVERSATION_LLM_ROUTE_MISSING',
        severity: 'warning',
        userMessage: `当前 ${label} 链路的模型不可用：${route.providerId}/${route.modelId}。请在 Settings 中刷新模型列表或重新选择 route。`,
        providerId: route.providerId,
        modelId: route.modelId,
      }),
    };
  }

  return {
    ok: true,
    agentId,
    routeAgentId,
    providerId: route.providerId,
    modelId: route.modelId,
  };
}

function resolveDebuggerRoutePreflight(): AgentRoutePreflight {
  return resolveAgentRoutePreflight('rdc-debugger');
}

function hasUsableDebuggerRoute(): boolean {
  return resolveDebuggerRoutePreflight().ok;
}

function recordCoworkLlmDiagnostic(
  context: ResolvedConversationContext,
  diagnostic: ConversationMessageDiagnostic,
): void {
  runtimeLogService.log({
    scope: context.session?.sessionId ? 'session' : 'app',
    namespace: 'llm',
    severity: diagnostic.severity === 'error' ? 'error' : 'warning',
    title: `${diagnostic.agentId ?? 'rdc-debugger'} -> ${diagnostic.providerId ?? 'route missing'}${diagnostic.modelId ? `/${diagnostic.modelId}` : ''}`,
    summary: diagnostic.userMessage,
    detail: diagnostic.technicalMessage,
    sessionId: context.session?.sessionId ?? null,
    projectId: context.projectId,
    runId: isActiveRun(context.currentRun) ? context.currentRun.runId : null,
    raw: {
      code: diagnostic.code,
      agentId: diagnostic.agentId,
      providerId: diagnostic.providerId,
      modelId: diagnostic.modelId,
      adapterId: diagnostic.adapterId,
    },
  });
}

function createRequestFailedDiagnostic(route: AgentRoutePreflightOk, error: unknown): ConversationMessageDiagnostic {
  const label = getConversationAgentLabel(route.agentId);
  return createConversationDiagnostic({
    agentId: route.agentId,
    code: 'CONVERSATION_LLM_REQUEST_FAILED',
    severity: 'error',
    userMessage: `模型请求失败：${label} 当前使用 ${route.providerId}/${route.modelId}，但服务商请求没有成功。请检查该账号、模型权限、额度或网络状态后重试。`,
    providerId: route.providerId,
    modelId: route.modelId,
    technicalMessage: redactTechnicalMessage(error),
  });
}

function extractRequestedCaptureName(message: string): string | null {
  const match = message.match(/([^\s"'“”‘’]+\.rdc)/i);
  return match?.[1] ? trimPathLabel(match[1].replace(/[，。；,;]+$/, '')) : null;
}

function shouldStartDebuggerFromMessage(message: string): boolean {
  if (!EXECUTE_PATTERN.test(message)) {
    return false;
  }
  return /\.rdc\b/i.test(message)
    || /event\s*id|事件\s*id|Event\s*\d+/i.test(message)
    || /帮我调试|请调试|开始调试|正式分析|直接过去看|定位根因|完整\s*report/i.test(message);
}

function captureDescriptorFromOpenedCapture(openedCapture: OpenedCaptureState): CaptureDescriptor {
  const normalizedPath = path.resolve(openedCapture.filePath);
  return {
    id: openedCapture.captureId || openedCapture.inputId,
    filePath: normalizedPath,
    captureFileId: openedCapture.captureFileId,
    role: 'primary',
    backendHint: openedCapture.backend,
    status: openedCapture.status,
    sessionId: openedCapture.sessionId,
    replaySessionId: openedCapture.replaySessionId,
    contextId: openedCapture.contextId,
  };
}

function resolveOpenedCaptureDescriptor(context: ResolvedConversationContext): CaptureDescriptor | null {
  return context.openedCapture?.status === 'open'
    ? captureDescriptorFromOpenedCapture(context.openedCapture)
    : null;
}

function resolveCaptureGuards(message: string, context: ResolvedConversationContext): {
  ready: boolean;
  reason?: string;
  needsCapture?: boolean;
  needsTargetCapture?: boolean;
} {
  if (resolveOpenedCaptureDescriptor(context)) {
    return { ready: true };
  }

  const requestedCaptureName = extractRequestedCaptureName(message);
  if (requestedCaptureName) {
    return {
      ready: false,
      needsCapture: true,
      reason: `我看到你提到了 ${requestedCaptureName}，但正式 Debugger 只能使用应用内已经 Open 的 .rdc Capture。请先在 Capture Library 打开该 capture，再进入执行模式。`,
    };
  }

  return {
    ready: false,
    needsCapture: true,
    reason: '我可以先帮你梳理问题，但正式 Debugger 执行需要先在应用内 Open 一个 .rdc Capture。仅在 prompt 中写路径不会创建 runtime context。',
  };
}

function buildWorkflowUpgradeReply(result: Awaited<ReturnType<typeof debuggerRuntime.startPlan>>): string {
  if (!result.success) {
    return result.error
      ? `我刚才尝试进入正式调试，但没有成功：${result.error}`
      : '我刚才尝试进入正式调试，但没有成功。';
  }

  if (result.debugPlanSummary?.blockers?.length) {
    const blocker = result.debugPlanSummary.blockers[0];
    if (blocker?.code === 'BLOCKED_LLM_ROUTE_MISSING'
      || blocker?.code === 'BLOCKED_LLM_PROVIDER_MISSING'
      || blocker?.code === 'BLOCKED_LLM_SECRET_MISSING'
      || blocker?.code === 'BLOCKED_LLM_MODEL_MISSING'
      || blocker?.code === 'BLOCKED_LLM_PROVIDER_UNAVAILABLE') {
      return '当前调试链路还没绑定可用模型，所以我不能开始正式执行；不过我可以先帮你确认问题范围和所需 capture。';
    }
    if (blocker?.code === 'BLOCKED_MISSING_CAPTURE') {
      return '我可以先帮你梳理问题，但正式分析需要一个 .rdc capture。你可以先描述现象，或者直接打开一个 capture。';
    }
    return blocker?.reason || '当前还不能进入正式调试。';
  }

  if (result.pendingQuestions?.questions.some((question) => question.id === 'target_capture')) {
    return '我已经开始整理正式执行计划了，不过当前还需要你明确这次要分析的 capture。';
  }

  if (result.status === 'awaiting_approval') {
    return '我已经整理好正式执行计划了。你先确认下方计划卡片，批准后我再进入严格调试流程。';
  }

  return '正式调试入口已准备完成，后续状态会在计划卡和运行记录中更新。';
}

function computeVisibleAssistantText(raw: string): string {
  const controlIndex = raw.indexOf(CONTROL_OPEN_TAG);
  if (controlIndex >= 0) {
    return raw.slice(0, controlIndex);
  }

  let partialMatchLength = 0;
  for (let index = CONTROL_OPEN_TAG.length - 1; index > 0; index -= 1) {
    if (raw.endsWith(CONTROL_OPEN_TAG.slice(0, index))) {
      partialMatchLength = index;
      break;
    }
  }

  return partialMatchLength > 0
    ? raw.slice(0, raw.length - partialMatchLength)
    : raw;
}

export class ConversationService {
  private activeTurns = new Map<string, ActiveConversationTurn>();

  async getHistory(sessionId: string): Promise<ConversationMessage[]> {
    return storageAdapter.readConversationHistory(sessionId);
  }

  async cancelActiveTurn(
    request: ConversationCancelActiveTurnRequest = {},
  ): Promise<ConversationCancelActiveTurnResult> {
    const candidates = Array.from(this.activeTurns.values())
      .filter((turn) => !request.turnId || turn.turnId === request.turnId)
      .filter((turn) => !request.sessionId || turn.sessionId === request.sessionId)
      .sort((left, right) => right.startedAt - left.startedAt);
    const target = candidates[0];
    if (!target) {
      return { success: false, error: 'No active conversation turn.' };
    }

    target.stop();
    return {
      success: true,
      cancelledTurnId: target.turnId,
    };
  }

  private registerActiveTurn(turn: ActiveConversationTurn): void {
    this.activeTurns.set(turn.turnId, turn);
  }

  private clearActiveTurn(turnId: string, controller: AbortController): void {
    const active = this.activeTurns.get(turnId);
    if (active?.abortController === controller) {
      this.activeTurns.delete(turnId);
    }
  }

  async sendMessage(input: ConversationContextInput): Promise<ConversationTurnResult> {
    const context = await this.resolveContext(input);
    if (isActiveRun(context.currentRun)) {
      return this.startActiveDebugTurn(context, input.mode, input.message.trim(), input.attachments ?? []);
    }

    return this.startCoworkTurn(context, input.mode, input.message.trim(), input.attachments ?? []);
  }

  private async resolveContext(input: ConversationContextInput): Promise<ResolvedConversationContext> {
    const projectId = input.projectId ?? input.fallbackProjectId ?? storageAdapter.getCurrentProjectId() ?? null;
    const persistedSessionId = await storageAdapter.getCurrentSessionId();
    const resolvedSessionId = input.sessionId ?? input.fallbackSessionId ?? persistedSessionId ?? null;
    const session = resolvedSessionId ? storageAdapter.readSession(resolvedSessionId) : null;
    const currentRun = resolvedSessionId
      ? storageAdapter.listRuns(resolvedSessionId).find((entry) => entry.runId === (input.currentRunId ?? input.fallbackRunId))
        ?? storageAdapter.getLatestRun(resolvedSessionId)
      : null;
    const projectInputs = projectId ? storageAdapter.listProjectInputs(projectId) : [];
    const openedCapture = rdxSessionService.snapshotOpenedCapture();
    const activeOpenedCapture = openedCapture?.projectId === projectId && openedCapture.status === 'open'
      ? openedCapture
      : null;
    const replayDevice = replayDeviceService.getDeviceById(input.replayDeviceId || 'local') ?? replayDeviceService.getDeviceById('local');

    return {
      projectId,
      session,
      currentRun,
      projectInputs,
      openedCapture: activeOpenedCapture,
      openedCapturePath: activeOpenedCapture?.filePath ?? null,
      replayDevice,
    };
  }

  private async startActiveDebugTurn(
    context: ResolvedConversationContext,
    requestedMode: AppMode,
    rawMessage: string,
    pendingAttachments: ConversationAttachmentInput[],
  ): Promise<ConversationTurnResult> {
    const turnId = generateEventId('turn');
    const attachments = context.session
      ? storageAdapter.importSessionAttachments(
          context.session.sessionId,
          pendingAttachments.map((entry) => entry.sourcePath),
        )
      : [];
    const userMessage = makeConversationMessage('user', rawMessage, {
      turnId,
      sessionId: context.session?.sessionId ?? null,
      projectId: context.projectId,
      runId: context.currentRun?.runId ?? null,
      modeContext: requestedMode,
      attachments,
      status: 'complete',
    });
    const assistantDraftMessage = makeConversationMessage('assistant', '', {
      turnId,
      sessionId: context.session?.sessionId ?? null,
      projectId: context.projectId,
      runId: context.currentRun?.runId ?? null,
      modeContext: requestedMode,
      agentId: 'rdc-debugger',
      status: 'streaming',
      reasoningTrace: createDraftReasoningTrace('正在思考', [
        createReasoningStep('active-debug-reply', '生成调试回复', 'investigate'),
      ]),
    });

    this.persistConversationSnapshot(context.session?.sessionId ?? null, userMessage);
    this.persistConversationSnapshot(context.session?.sessionId ?? null, assistantDraftMessage);
    this.publishWorkstream(context.session?.sessionId ?? null);

    void this.completeActiveDebugTurn({
      context,
      requestedMode,
      userMessage,
      assistantDraftMessage,
    });

    return {
      session: context.session,
      mode: 'active_debug',
      userMessage,
      assistantDraftMessage,
      executionTransition: { action: 'none' },
      runUpdate: context.currentRun,
      errorViewModel: null,
    };
  }

  private async completeActiveDebugTurn(input: {
    context: ResolvedConversationContext;
    requestedMode: AppMode;
    userMessage: ConversationMessage;
    assistantDraftMessage: ConversationMessage;
  }) {
    let assistantMessage = input.assistantDraftMessage;
    const sessionId = input.context.session?.sessionId ?? null;
    const workstreamSessionId = sessionId ?? this.ephemeralWorkstreamSessionId(input.assistantDraftMessage.turnId);
    const abortController = new AbortController();

    const commitAssistantMessage = (type: ConversationStreamEvent['type'], patch: Partial<ConversationMessage>) => {
      if (abortController.signal.aborted && patch.status !== 'stopped') {
        return;
      }
      assistantMessage = {
        ...assistantMessage,
        ...patch,
        updatedAt: nowMs(),
      };
      this.persistConversationSnapshot(sessionId, assistantMessage);
      this.emitConversationEvent({
        type,
        sessionId: sessionId ?? '',
        turnId: assistantMessage.turnId,
        message: assistantMessage,
      } as ConversationStreamEvent);
      this.publishConversationWorkstream(workstreamSessionId, [input.userMessage, assistantMessage], sessionId);
    };

    const commitStoppedMessage = () => {
      commitAssistantMessage('message_completed', {
        status: 'stopped',
        content: assistantMessage.content || '当前请求已停止。',
        reasoningTrace: finalizeTrace(
          upsertTraceStep(assistantMessage.reasoningTrace, 'active-debug-reply', {
            status: 'complete',
            summary: '用户已停止当前请求。',
            completedAt: nowMs(),
          }),
          'stopped',
          '请求已停止',
        ),
      });
    };

    this.registerActiveTurn({
      turnId: assistantMessage.turnId,
      sessionId,
      startedAt: nowMs(),
      abortController,
      stop: () => {
        if (!abortController.signal.aborted) {
          abortController.abort();
          commitStoppedMessage();
        }
      },
    });

    commitAssistantMessage('message_patched', {
      reasoningTrace: upsertTraceStep(
        assistantMessage.reasoningTrace,
        'active-debug-reply',
        {
          title: '生成调试回复',
          stage: 'investigate',
          status: 'running',
          summary: 'Debugger 正在结合当前 run 上下文生成回复。',
          startedAt: nowMs(),
        },
      ),
    });

    try {
      const responseText = await agentOrchestrator.sendMessage(
        'rdc-debugger',
        composeMessageForAgent(input.userMessage),
        {
          caseId: input.context.session?.sessionId,
          runId: input.context.currentRun?.runId ?? undefined,
          sessionId: input.context.session?.sessionId ?? undefined,
          turnId: assistantMessage.turnId,
        },
        {
          onChunk: (chunk) => {
            commitAssistantMessage('message_patched', {
              status: 'streaming',
              content: `${assistantMessage.content}${chunk}`,
            });
          },
          signal: abortController.signal,
        },
      );

      commitAssistantMessage('message_completed', {
        status: 'complete',
        content: responseText,
        reasoningTrace: finalizeTrace(
          upsertTraceStep(
            assistantMessage.reasoningTrace,
            'active-debug-reply',
            {
              status: 'complete',
              summary: '调试回复已生成。',
              completedAt: nowMs(),
            },
          ),
          'complete',
          '回复已完成',
        ),
      });
    } catch (error) {
      const routePreflight = resolveDebuggerRoutePreflight();
      const diagnostic = routePreflight.ok
        ? createRequestFailedDiagnostic(routePreflight, error)
        : routePreflight.diagnostic;
      recordCoworkLlmDiagnostic(input.context, diagnostic);
      const message = diagnostic.userMessage;
      commitAssistantMessage('message_errored', {
        status: 'error',
        content: assistantMessage.content || message,
        diagnostic,
        reasoningTrace: finalizeTrace(
          upsertTraceStep(
            assistantMessage.reasoningTrace,
            'active-debug-reply',
            {
              status: 'error',
              summary: message,
              detail: diagnostic.technicalMessage,
              completedAt: nowMs(),
            },
          ),
          'error',
          '回复生成失败',
        ),
      });
    } finally {
      this.clearActiveTurn(assistantMessage.turnId, abortController);
    }
  }

  private async startCoworkTurn(
    context: ResolvedConversationContext,
    requestedMode: AppMode,
    rawMessage: string,
    pendingAttachments: ConversationAttachmentInput[],
  ): Promise<ConversationTurnResult> {
    let workingSession = context.session;
    if (!workingSession && context.projectId) {
      workingSession = storageAdapter.createSession(context.projectId, rawMessage.slice(0, 80));
    }

    const turnId = generateEventId('turn');
    const importedAttachments = workingSession
      ? storageAdapter.importSessionAttachments(
          workingSession.sessionId,
          pendingAttachments.map((entry) => entry.sourcePath),
        )
      : [];
    const userMessage = makeConversationMessage('user', rawMessage, {
      turnId,
      sessionId: workingSession?.sessionId ?? null,
      projectId: context.projectId,
      runId: isActiveRun(context.currentRun) ? context.currentRun.runId : null,
      modeContext: requestedMode,
      attachments: importedAttachments,
      status: 'complete',
    });
    const assistantDraftMessage = makeConversationMessage('assistant', '', {
      turnId,
      sessionId: workingSession?.sessionId ?? null,
      projectId: context.projectId,
      runId: isActiveRun(context.currentRun) ? context.currentRun.runId : null,
      modeContext: requestedMode,
      agentId: requestedMode === 'ask' ? 'ask_agent' : 'rdc-debugger',
      status: 'streaming',
      reasoningTrace: requestedMode === 'ask'
        ? null
        : createDraftReasoningTrace('正在思考', [
            createReasoningStep('cowork-route', '检查上下文与路由', 'intake_gate'),
            createReasoningStep('cowork-reply', '生成协作回复', 'plan'),
          ]),
    });

    if (!context.projectId && EXECUTE_PATTERN.test(rawMessage)) {
      const assistantMessage: ConversationMessage = {
        ...assistantDraftMessage,
        content: '我可以先帮你梳理问题，不过正式调试要先选一个项目。选好项目后，你可以继续描述现象，或者直接打开一个 .rdc capture。',
        status: 'complete',
        updatedAt: nowMs(),
      };
      const workstreamSessionId = this.ephemeralWorkstreamSessionId(turnId);
      const tracePresentation = await traceService.buildConversationPresentation(
        workstreamSessionId,
        [userMessage, assistantMessage],
      );
      workflowProjectionPublisher.publishTraceProjectionChanged(workstreamSessionId, tracePresentation);
      this.publishConversationWorkstream(workstreamSessionId, [userMessage, assistantMessage], null);
      return {
        session: null,
        mode: 'talk',
        userMessage,
        assistantDraftMessage: assistantMessage,
        executionTransition: { action: 'none' },
        runUpdate: null,
        tracePresentation,
        errorViewModel: null,
      };
    }

    this.persistConversationSnapshot(workingSession?.sessionId ?? null, userMessage);
    this.persistConversationSnapshot(workingSession?.sessionId ?? null, assistantDraftMessage);
    const workstreamSessionId = workingSession?.sessionId ?? this.ephemeralWorkstreamSessionId(turnId);
    const tracePresentation = await traceService.buildConversationPresentation(
      workstreamSessionId,
      [userMessage, assistantDraftMessage],
    );
    workflowProjectionPublisher.publishTraceProjectionChanged(workstreamSessionId, tracePresentation);
    this.publishConversationWorkstream(workstreamSessionId, [userMessage, assistantDraftMessage], workingSession?.sessionId ?? null);

    void this.completeCoworkTurn({
      context: {
        ...context,
        session: workingSession,
      },
      requestedMode,
      rawMessage,
      importedAttachments,
      userMessage,
      assistantDraftMessage,
    });

    return {
      session: workingSession,
      mode: 'talk',
      userMessage,
      assistantDraftMessage,
      executionTransition: { action: 'none' },
      runUpdate: null,
      tracePresentation,
      errorViewModel: null,
    };
  }

  private async completeCoworkTurn(input: {
    context: ResolvedConversationContext;
    requestedMode: AppMode;
    rawMessage: string;
    importedAttachments: SessionAttachmentRecord[];
    userMessage: ConversationMessage;
    assistantDraftMessage: ConversationMessage;
  }) {
    let assistantMessage = input.assistantDraftMessage;
    const sessionId = input.context.session?.sessionId ?? null;
    const workstreamSessionId = sessionId ?? this.ephemeralWorkstreamSessionId(input.assistantDraftMessage.turnId);
    const abortController = new AbortController();
    const conversationAgentId: AgentRole = input.requestedMode === 'ask' ? 'ask_agent' : 'rdc-debugger';
    const showCoworkReasoning = input.requestedMode !== 'ask';

    const commitAssistantMessage = (type: ConversationStreamEvent['type'], patch: Partial<ConversationMessage>) => {
      if (abortController.signal.aborted && patch.status !== 'stopped') {
        return;
      }
      assistantMessage = {
        ...assistantMessage,
        ...patch,
        updatedAt: nowMs(),
      };
      this.persistConversationSnapshot(sessionId, assistantMessage);
      this.emitConversationEvent({
        type,
        sessionId: sessionId ?? '',
        turnId: assistantMessage.turnId,
        message: assistantMessage,
      } as ConversationStreamEvent);
      this.publishConversationWorkstream(workstreamSessionId, [input.userMessage, assistantMessage], sessionId);
    };

    const commitStoppedMessage = () => {
      commitAssistantMessage('message_completed', {
        status: 'stopped',
        content: assistantMessage.content || '当前请求已停止。',
        reasoningTrace: finalizeTrace(
          upsertTraceStep(assistantMessage.reasoningTrace, 'cowork-reply', {
            status: 'complete',
            summary: '用户已停止当前请求。',
            completedAt: nowMs(),
          }),
          'stopped',
          '请求已停止',
        ),
      });
    };

    this.registerActiveTurn({
      turnId: assistantMessage.turnId,
      sessionId,
      startedAt: nowMs(),
      abortController,
      stop: () => {
        if (!abortController.signal.aborted) {
          abortController.abort();
          commitStoppedMessage();
        }
      },
    });

    let systemAppendix = '';

    const commitVisibleAssistantText = () => {
      commitAssistantMessage('message_patched', {
        status: 'streaming',
        content: `${visibleResponse}${systemAppendix}`,
      });
    };

    const appendSystemAppendix = (text: string) => {
      if (!text) {
        return;
      }
      systemAppendix += text;
      commitVisibleAssistantText();
    };

    const withCoworkReasoning = (reasoningTrace: ConversationReasoningTrace): Partial<ConversationMessage> => (
      showCoworkReasoning ? { reasoningTrace } : {}
    );

    if (showCoworkReasoning) {
      commitAssistantMessage('message_patched', {
        reasoningTrace: upsertTraceStep(assistantMessage.reasoningTrace, 'cowork-route', {
          status: 'running',
          summary: '正在检查项目、capture 与调试路由。',
          startedAt: nowMs(),
        }),
      });
    }

    const history = input.context.session
      ? storageAdapter.readConversationHistory(input.context.session.sessionId).filter((entry) => entry.id !== assistantMessage.id)
      : [];

    let rawResponse = '';
    let visibleResponse = '';
    let errorViewModel: ConversationTurnResult['errorViewModel'] = null;
    let llmDiagnostic: ConversationMessageDiagnostic | null = null;
    const taskFileContext = resolveTaskFileContext(input.rawMessage);
    const effectiveMessage = taskFileContext.effectiveMessage;
    const explicitFormalDebugRequest = shouldStartDebuggerFromMessage(effectiveMessage);
    const explicitDebuggerRequest = input.requestedMode === 'debugger' && explicitFormalDebugRequest;
    const askModeFormalDebugRequest = input.requestedMode === 'ask' && explicitFormalDebugRequest;
    const explicitDebuggerCaptureGuard = explicitDebuggerRequest
      ? resolveCaptureGuards(effectiveMessage, input.context)
      : null;
    const askModeCaptureGuard = askModeFormalDebugRequest
      ? resolveCaptureGuards(effectiveMessage, input.context)
      : null;

    const routePreflight = conversationAgentId === 'ask_agent'
      ? resolveAgentRoutePreflight('ask_agent', 'rdc-debugger')
      : resolveDebuggerRoutePreflight();
    if (askModeFormalDebugRequest) {
      rawResponse = [
        askModeCaptureGuard?.ready
          ? '当前 Ask 不会直接创建正式 run。Capture 已经 Open；如需执行，请切换到 Debugger 后发送，我会先生成执行前计划。'
          : askModeCaptureGuard?.reason || '正式 Debugger 执行需要先在应用内 Open 一个 .rdc Capture。',
        '<control>{"intent":"intake","safe_to_start":false,"needs_capture":true}</control>',
      ].join('\n');
      visibleResponse = stripControlBlock(rawResponse);
      commitVisibleAssistantText();
      commitAssistantMessage('message_patched', {
        ...withCoworkReasoning(upsertTraceStep(assistantMessage.reasoningTrace, 'cowork-reply', {
          status: 'complete',
          summary: 'Ask 模式保留为非执行入口，已提示用户通过 Open 和 Debugger 模式进入计划。',
          completedAt: nowMs(),
        })),
      });
    } else if (explicitDebuggerRequest && explicitDebuggerCaptureGuard && !explicitDebuggerCaptureGuard.ready) {
      rawResponse = [
        explicitDebuggerCaptureGuard.reason || '正式 Debugger 执行需要先在应用内 Open 一个 .rdc Capture。',
        '<control>{"intent":"intake","safe_to_start":false,"needs_capture":true}</control>',
      ].join('\n');
      visibleResponse = stripControlBlock(rawResponse);
      commitVisibleAssistantText();
      commitAssistantMessage('message_patched', {
        ...withCoworkReasoning(upsertTraceStep(assistantMessage.reasoningTrace, 'cowork-reply', {
          status: 'complete',
          summary: '已拦截正式 Debugger 请求，等待应用内 Open capture。',
          completedAt: nowMs(),
        })),
      });
    } else if (explicitDebuggerRequest && !routePreflight.ok && routePreflight.diagnostic.code !== 'CONVERSATION_LLM_ROUTE_MISSING') {
      llmDiagnostic = routePreflight.diagnostic;
      errorViewModel = {
        code: llmDiagnostic.code,
        message: llmDiagnostic.userMessage,
        technicalMessage: llmDiagnostic.technicalMessage,
      };
      rawResponse = llmDiagnostic.userMessage;
      visibleResponse = llmDiagnostic.userMessage;
      recordCoworkLlmDiagnostic(input.context, llmDiagnostic);
      commitVisibleAssistantText();
    } else if (explicitDebuggerRequest) {
      if (!routePreflight.ok) {
        llmDiagnostic = routePreflight.diagnostic;
        recordCoworkLlmDiagnostic(input.context, llmDiagnostic);
      }
      rawResponse = [
        '已识别为 Debugger 执行请求。我会先生成执行前计划，等待你确认后再进入正式调试。',
        '<control>{"intent":"execute","safe_to_start":true}</control>',
      ].join('\n');
      visibleResponse = stripControlBlock(rawResponse);
      commitVisibleAssistantText();
      commitAssistantMessage('message_patched', {
        ...withCoworkReasoning(upsertTraceStep(assistantMessage.reasoningTrace, 'cowork-reply', {
          status: 'complete',
          summary: '已识别为正式 Debugger 任务，准备生成执行前计划。',
          completedAt: nowMs(),
        })),
      });
    } else if (!routePreflight.ok) {
      llmDiagnostic = routePreflight.diagnostic;
      errorViewModel = {
        code: llmDiagnostic.code,
        message: llmDiagnostic.userMessage,
        technicalMessage: llmDiagnostic.technicalMessage,
      };
      rawResponse = llmDiagnostic.userMessage;
      visibleResponse = llmDiagnostic.userMessage;
      recordCoworkLlmDiagnostic(input.context, llmDiagnostic);
      commitVisibleAssistantText();
    } else {
      try {
        if (showCoworkReasoning) {
          commitAssistantMessage('message_patched', {
            reasoningTrace: upsertTraceStep(assistantMessage.reasoningTrace, 'cowork-reply', {
              status: 'running',
              summary: `正在通过 ${routePreflight.providerId}/${routePreflight.modelId} 生成协作回复。`,
              startedAt: nowMs(),
            }),
          });
        }

        const coworkPrompt = buildCoworkPrompt(
          input.context,
          history,
          input.requestedMode,
          input.rawMessage,
          input.importedAttachments,
        );
        const responseText = await agentOrchestrator.sendCoworkMessage(
          conversationAgentId,
          input.rawMessage,
          {
            sessionId: input.context.session?.sessionId,
            turnId: assistantMessage.turnId,
            stage: 'cowork',
            patternId: input.requestedMode === 'debugger' ? 'plan-generate-verify' : 'free-agent',
            systemPrompt: conversationAgentId === 'ask_agent'
              ? buildAskSystemPrompt()
              : buildDebuggerCoworkSystemPrompt(),
            maxTokens: 1200,
            temperature: 0.35,
            signal: abortController.signal,
            promptOverride: coworkPrompt,
            onEvent: (event: AgentEvent) => {
              this.emitConversationEvent({
                type: 'agent_event',
                sessionId: sessionId ?? '',
                turnId: assistantMessage.turnId,
                event,
              });
              if (event.type === 'assistant.delta') {
                const chunk = typeof event.payload.text === 'string' ? event.payload.text : '';
                rawResponse += chunk;
                const nextVisible = computeVisibleAssistantText(rawResponse);
                if (nextVisible.length > visibleResponse.length) {
                  visibleResponse = nextVisible;
                  commitVisibleAssistantText();
                }
              }
              if (event.type === 'tool.started') {
                commitAssistantMessage('message_patched', {
                  reasoningTrace: upsertRuntimeToolCall(assistantMessage.reasoningTrace, {
                    id: String(event.payload.toolCallId),
                    toolName: String(event.payload.toolName),
                    status: 'running',
                    argsPreview: JSON.stringify(event.payload.args ?? {}).slice(0, 600),
                    startedAt: nowMs(),
                  }),
                });
              }
              if (event.type === 'tool.completed') {
                const result = event.payload.result as { ok?: boolean; error?: { message?: string } } | undefined;
                commitAssistantMessage('message_patched', {
                  reasoningTrace: upsertRuntimeToolCall(assistantMessage.reasoningTrace, {
                    id: String(event.payload.toolCallId),
                    toolName: String(event.payload.toolName),
                    status: result?.ok ? 'complete' : 'error',
                    resultPreview: JSON.stringify(event.payload.result ?? {}).slice(0, 800),
                    error: result?.ok ? undefined : result?.error?.message,
                    completedAt: nowMs(),
                  }),
                });
              }
            },
          },
        );

        if (!rawResponse) {
          rawResponse = responseText;
        }
      } catch (error) {
        llmDiagnostic = createRequestFailedDiagnostic(routePreflight, error);
        errorViewModel = {
          code: llmDiagnostic.code,
          message: llmDiagnostic.userMessage,
          technicalMessage: llmDiagnostic.technicalMessage,
        };
        rawResponse = llmDiagnostic.userMessage;
        visibleResponse = llmDiagnostic.userMessage;
        recordCoworkLlmDiagnostic(input.context, llmDiagnostic);
        commitVisibleAssistantText();
      }
    }

    if (abortController.signal.aborted) {
      this.clearActiveTurn(assistantMessage.turnId, abortController);
      return;
    }

    const assistantContent = stripControlBlock(rawResponse);
    visibleResponse = assistantContent;
    const control = parseControlBlock(rawResponse);
    const isRouteMissingDiagnostic = llmDiagnostic?.code === 'CONVERSATION_LLM_ROUTE_MISSING';
    let finalStatus: ConversationMessage['status'] = errorViewModel && !isRouteMissingDiagnostic ? 'error' : 'complete';
    let traceStatus: ConversationReasoningTrace['status'] = errorViewModel && !isRouteMissingDiagnostic ? 'error' : 'complete';

    commitAssistantMessage('message_patched', {
      content: `${visibleResponse}${systemAppendix}`,
      diagnostic: llmDiagnostic,
      ...withCoworkReasoning(upsertTraceStep(assistantMessage.reasoningTrace, 'cowork-route', {
        status: 'complete',
        summary: llmDiagnostic
          ? `模型链路诊断完成：${llmDiagnostic.providerId ? `${llmDiagnostic.providerId}${llmDiagnostic.modelId ? `/${llmDiagnostic.modelId}` : ''}` : '缺少 route'}。`
          : '上下文检查完成。',
        completedAt: nowMs(),
      })),
    });

    if (abortController.signal.aborted) {
      this.clearActiveTurn(assistantMessage.turnId, abortController);
      return;
    }

    if (!input.context.projectId && EXECUTE_PATTERN.test(effectiveMessage)) {
      const boundaryReply = '我可以先帮你梳理问题，不过正式调试要先选一个项目。选好项目后，你可以继续描述现象，或者直接打开一个 .rdc capture。';
      commitAssistantMessage('message_completed', {
        status: 'complete',
        content: boundaryReply,
        ...withCoworkReasoning(finalizeTrace(
          upsertTraceStep(
            upsertTraceStep(assistantMessage.reasoningTrace, 'cowork-route', {
              status: 'complete',
              summary: '当前还没有可用项目。',
              completedAt: nowMs(),
            }),
            'cowork-upgrade',
            {
              title: '升级到正式调试',
              stage: 'plan',
              status: 'complete',
              summary: '已拦截正式调试请求，等待选择项目。',
              completedAt: nowMs(),
            },
          ),
          'complete',
          '等待选择项目',
        )),
      });
      this.clearActiveTurn(assistantMessage.turnId, abortController);
      return;
    }

    const shouldUpgradeByControl = input.requestedMode === 'debugger' && control?.intent === 'execute' && control.safe_to_start;
    const shouldUpgradeByRequest = !errorViewModel
      && explicitDebuggerRequest
      && explicitDebuggerCaptureGuard?.ready === true;
    if (shouldUpgradeByControl || shouldUpgradeByRequest) {
      commitAssistantMessage('message_patched', {
        reasoningTrace: upsertTraceStep(assistantMessage.reasoningTrace, 'cowork-upgrade', {
          title: '升级到正式调试',
          stage: 'plan',
          status: 'running',
          summary: '正在准备正式调试计划。',
          startedAt: nowMs(),
        }),
      });

      if (!input.context.projectId) {
        appendSystemAppendix(`\n\n我可以先帮你梳理问题，不过正式调试要先选一个项目。选好项目后，你可以继续描述现象，或者直接打开一个 .rdc capture。`);
      } else {
        const captureGuard = resolveCaptureGuards(effectiveMessage, input.context);
        if (!captureGuard.ready) {
          appendSystemAppendix(`\n\n${captureGuard.reason || '当前还不能进入正式分析。'}`);
        } else if (!hasUsableDebuggerRoute()) {
          appendSystemAppendix('\n\n当前调试链路还没绑定可用模型，所以我不能开始正式执行；不过我可以先帮你确认问题范围和所需 capture。');
        } else {
          if (abortController.signal.aborted) {
            this.clearActiveTurn(assistantMessage.turnId, abortController);
            return;
          }
          const requestedCapture = resolveOpenedCaptureDescriptor(input.context);
          const workflowResult = await debuggerRuntime.requestStartFromConversation({
            source: 'conversation',
            message: assistantMessage,
            projectId: input.context.projectId,
            sessionId: input.context.session?.sessionId,
            turnId: assistantMessage.turnId,
            mode: 'debugger',
            goal: input.rawMessage,
            captures: requestedCapture ? [requestedCapture] : undefined,
            primaryCaptureId: requestedCapture?.id,
            replayDevice: input.context.replayDevice,
          });

          if (abortController.signal.aborted) {
            this.clearActiveTurn(assistantMessage.turnId, abortController);
            return;
          }

          const upgradeReply = buildWorkflowUpgradeReply(workflowResult);
          appendSystemAppendix(`\n\n${upgradeReply}`);

          if (workflowResult.runId) {
            commitAssistantMessage('message_patched', {
              runId: workflowResult.runId,
            });
            this.emitConversationEvent({
              type: 'run_linked',
              sessionId: input.context.session?.sessionId ?? '',
              turnId: assistantMessage.turnId,
              runId: workflowResult.runId,
            });
          }
        }
      }

      commitAssistantMessage('message_patched', {
        reasoningTrace: upsertTraceStep(assistantMessage.reasoningTrace, 'cowork-upgrade', {
          status: 'complete',
          summary: '正式调试升级判断已完成。',
          completedAt: nowMs(),
        }),
      });
    }

    commitAssistantMessage(finalStatus === 'error' ? 'message_errored' : 'message_completed', {
      status: finalStatus,
      content: `${assistantContent}${systemAppendix}`,
      diagnostic: llmDiagnostic,
      ...withCoworkReasoning(finalizeTrace(
        upsertTraceStep(assistantMessage.reasoningTrace, 'cowork-reply', {
          status: errorViewModel && !isRouteMissingDiagnostic ? 'error' : 'complete',
          summary: llmDiagnostic
            ? llmDiagnostic.code === 'CONVERSATION_LLM_REQUEST_FAILED'
              ? '模型请求失败，已记录诊断。'
              : '模型链路不可用，已给出配置诊断。'
            : explicitDebuggerRequest
              ? '正式 Debugger 任务入口判断已完成。'
            : '协作回复已完成。',
          detail: llmDiagnostic?.technicalMessage,
          completedAt: nowMs(),
        }),
        traceStatus,
        llmDiagnostic
          ? finalStatus === 'error'
            ? '回复失败'
            : '等待模型配置'
          : explicitDebuggerRequest
            ? '已完成执行入口判断'
          : '回复已完成',
      )),
    });
    this.clearActiveTurn(assistantMessage.turnId, abortController);
  }

  private persistConversationSnapshot(sessionId: string | null | undefined, message: ConversationMessage) {
    if (sessionId) {
      storageAdapter.appendConversationMessage(sessionId, message);
    }
  }

  private emitConversationEvent(event: ConversationStreamEvent) {
    workflowProjectionPublisher.publishConversationEvent(event);
  }

  private publishWorkstream(sessionId: string | null | undefined): void {
    if (!sessionId) {
      return;
    }

    void traceService.getSession(sessionId)
      .then((result) => {
        if (result.success && result.presentation) {
          workflowProjectionPublisher.publishTraceProjectionChanged(sessionId, result.presentation);
        }
      })
      .catch((error) => {
        console.error('[ConversationService] Failed to publish trace projection:', error);
      });
  }

  private publishConversationWorkstream(
    workstreamSessionId: string,
    messages: ConversationMessage[],
    persistedSessionId?: string | null,
  ): void {
    if (persistedSessionId) {
      this.publishWorkstream(persistedSessionId);
      return;
    }

    void traceService.buildConversationPresentation(workstreamSessionId, messages)
      .then((presentation) => {
        workflowProjectionPublisher.publishTraceProjectionChanged(workstreamSessionId, presentation);
      });
  }

  private ephemeralWorkstreamSessionId(turnId: string): string {
    return `conversation-${turnId}`;
  }
}

export const conversationService = new ConversationService();
