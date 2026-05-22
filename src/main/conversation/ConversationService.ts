import fs from 'fs';
import path from 'path';
import type {
  ConversationAttachmentInput,
  ConversationCancelActiveTurnRequest,
  ConversationCancelActiveTurnResult,
  ConversationControl,
  ConversationMessage,
  ConversationReasoningStep,
  ConversationReasoningTrace,
  ConversationSendRequest,
  ConversationStreamEvent,
  ConversationTurnResult,
} from '@shared/types/conversation';
import type {
  AppMode,
  ProjectInputRecord,
  RunSummary,
  SessionAttachmentRecord,
  SessionRecord,
} from '@shared/types/session';
import type { ReplayDeviceEntry } from '@shared/types/device';
import { generateEventId, nowMs } from '@shared/utils/id';
import { agentOrchestrator } from '../workflow/debugger/AgentOrchestrator';
import { debuggerRuntime } from '../workflow/debugger/DebuggerRuntime';
import { replayDeviceService } from '../captures/ReplayDeviceService';
import { rdxSessionService } from '../index';
import { settingsService } from '../settings/SettingsService';
import { storageAdapter } from '../sessions/StorageAdapter';
import { workflowProjectionPublisher } from '../workflow/debugger/WorkflowProjectionPublisher';

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

const EXECUTE_PATTERN = /开始|启动|执行|正式分析|直接分析|现在分析|run\b|start\b|debug\b|analy[sz]e\b|帮我调试|请调试|开始调试|开始分析/i;
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
    requested_mode_label: mode === 'debugger'
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
    active_run_id: context.currentRun?.runId ?? null,
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

function buildCoworkSystemPrompt(): string {
  return [
    '你是 RDC Debugger，一个面向 RenderDoc 调试场景的 Cowork Agent。',
    '要求：',
    '1. 始终先用自然中文正常回复用户，不要像审批流或工单流。',
    '2. 如果用户问通用知识、产品能力、技术概念，直接回答，不要强行转成调试执行。',
    '3. 没有正式进入调试 run 前，不要假装自己已经分析过 capture。',
    '4. 只有当用户明确表达“现在开始正式调试/执行分析”，并且条件足够时，才把 intent 标成 execute。',
    '5. 回复正文结束后，必须额外附加一个 <control>{...}</control> 块，control JSON 只允许包含 intent, safe_to_start, needs_project, needs_capture, needs_target_capture, needs_route, reason。',
    '6. 如果你不确定，就把 intent 设为 talk 或 intake，safe_to_start 设为 false。',
    '7. 控制块不要在正文里解释给用户。',
    '8. requested_mode 表示当前 UI 模式，Debugger 偏重定位与排障，Analyzer 偏重拆解与证据整理，Optimizer 偏重瓶颈判断与优化建议；回答结构要随 mode 调整。',
  ].join('\n');
}

function hasUsableDebuggerRoute(): boolean {
  const settings = settingsService.getAll();
  const route = settings.llm.agentRoutes.find((entry) => entry.agentId === 'rdc-debugger');
  if (!route?.providerId || !route.modelId) {
    return false;
  }

  const provider = settings.llm.providers.find((entry) => entry.id === route.providerId);
  if (!provider || !provider.enabled) {
    return false;
  }

  return provider.models.some((entry) => entry.id === route.modelId && entry.enabled);
}

function inferExplicitCapture(message: string, projectInputs: ProjectInputRecord[]): ProjectInputRecord | null {
  return projectInputs.find((entry) => message.includes(entry.fileName)) ?? null;
}

function resolveCaptureGuards(message: string, context: ResolvedConversationContext): {
  ready: boolean;
  reason?: string;
  needsCapture?: boolean;
  needsTargetCapture?: boolean;
} {
  const explicitCapture = inferExplicitCapture(message, context.projectInputs);
  if (context.openedCapturePath || explicitCapture) {
    return { ready: true };
  }

  if (context.projectInputs.length === 0) {
    return {
      ready: false,
      needsCapture: true,
      reason: '我可以先帮你梳理问题，但正式分析需要一个 .rdc capture。你可以先描述现象，或者直接打开一个 capture。',
    };
  }

  if (context.projectInputs.length > 1) {
    const captureLabels = context.projectInputs.slice(0, 3).map((entry) => trimPathLabel(entry.fileName));
    return {
      ready: false,
      needsTargetCapture: true,
      reason: `我看到项目里有多个 capture：${captureLabels.join('、')}。你先告诉我这次要看哪一个，我再进入正式分析。`,
    };
  }

  return { ready: true };
}

function createFallbackAssistantReply(message: string, context: ResolvedConversationContext): string {
  if (!context.projectId && EXECUTE_PATTERN.test(message)) {
    return '我可以先帮你梳理问题，不过正式调试要先选一个项目。选好项目后，你可以继续描述现象，或者直接打开一个 .rdc capture。';
  }

  if (!hasUsableDebuggerRoute()) {
    if (/你好|您好|hello|hi/i.test(message)) {
      return '当前模型链路还没准备好。请先配置 `rdc-debugger` 的 provider / model route。';
    }
    if (EXECUTE_PATTERN.test(message)) {
      return '当前调试链路还没绑定可用模型，所以我不能开始正式执行；不过我可以先帮你确认问题范围和所需 capture。';
    }
    return '当前拿不到核心模型回复。请检查 `rdc-debugger` 的 provider / model route。';
  }

  return '我刚才没能稳定产出这轮对话回复。你可以重试一次；如果问题持续，优先检查当前 `rdc-debugger` 的模型链路。';
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

  return '我已经开始正式调试。接下来会按严格证据链推进分析。';
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
    if (context.currentRun && ACTIVE_RUN_STATUSES.includes(context.currentRun.status)) {
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
    const replayDevice = replayDeviceService.getDeviceById(input.replayDeviceId || 'local') ?? replayDeviceService.getDeviceById('local');

    return {
      projectId,
      session,
      currentRun,
      projectInputs,
      openedCapturePath: openedCapture?.filePath ?? null,
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
      const message = error instanceof Error
        ? `我刚才处理这条消息时失败了：${error.message}`
        : '我刚才处理这条消息时失败了。';
      commitAssistantMessage('message_errored', {
        status: 'error',
        content: assistantMessage.content || message,
        reasoningTrace: finalizeTrace(
          upsertTraceStep(
            assistantMessage.reasoningTrace,
            'active-debug-reply',
            {
              status: 'error',
              summary: message,
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
      runId: context.currentRun?.runId ?? null,
      modeContext: requestedMode,
      attachments: importedAttachments,
      status: 'complete',
    });
    const assistantDraftMessage = makeConversationMessage('assistant', '', {
      turnId,
      sessionId: workingSession?.sessionId ?? null,
      projectId: context.projectId,
      runId: context.currentRun?.runId ?? null,
      modeContext: requestedMode,
      agentId: 'rdc-debugger',
      status: 'streaming',
      reasoningTrace: createDraftReasoningTrace('正在思考', [
        createReasoningStep('cowork-route', '检查上下文与路由', 'intake_gate'),
        createReasoningStep('cowork-reply', '生成协作回复', 'plan'),
      ]),
    });

    this.persistConversationSnapshot(workingSession?.sessionId ?? null, userMessage);
    this.persistConversationSnapshot(workingSession?.sessionId ?? null, assistantDraftMessage);

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

    commitAssistantMessage('message_patched', {
      reasoningTrace: upsertTraceStep(assistantMessage.reasoningTrace, 'cowork-route', {
        status: 'running',
        summary: '正在检查项目、capture 与调试路由。',
        startedAt: nowMs(),
      }),
    });

    const history = input.context.session
      ? storageAdapter.readConversationHistory(input.context.session.sessionId).filter((entry) => entry.id !== assistantMessage.id)
      : [];

    let rawResponse = '';
    let visibleResponse = '';
    let errorViewModel: ConversationTurnResult['errorViewModel'] = null;

    try {
      commitAssistantMessage('message_patched', {
        reasoningTrace: upsertTraceStep(assistantMessage.reasoningTrace, 'cowork-reply', {
          status: 'running',
          summary: '正在生成协作回复。',
          startedAt: nowMs(),
        }),
      });

      const response = await agentOrchestrator.sendCoworkMessage(
        'rdc-debugger',
        buildCoworkPrompt(
          input.context,
          history,
          input.requestedMode,
          input.rawMessage,
          input.importedAttachments,
        ),
        {
          sessionId: input.context.session?.sessionId,
          turnId: assistantMessage.turnId,
          systemPrompt: buildCoworkSystemPrompt(),
          maxTokens: 1200,
          temperature: 0.35,
          signal: abortController.signal,
          onChunk: (chunk) => {
            rawResponse += chunk;
            const nextVisible = computeVisibleAssistantText(rawResponse);
            if (nextVisible.length > visibleResponse.length) {
              visibleResponse = nextVisible;
              commitVisibleAssistantText();
            }
          },
        },
      );

      if (!rawResponse) {
        rawResponse = response;
      }
    } catch (error) {
      const fallbackReply = createFallbackAssistantReply(resolveTaskFileContext(input.rawMessage).effectiveMessage, input.context);
      errorViewModel = {
        code: 'CONVERSATION_LLM_UNAVAILABLE',
        message: fallbackReply,
        technicalMessage: error instanceof Error ? error.message : String(error),
      };
      rawResponse = fallbackReply;
      visibleResponse = fallbackReply;
      commitVisibleAssistantText();
    }

    if (abortController.signal.aborted) {
      this.clearActiveTurn(assistantMessage.turnId, abortController);
      return;
    }

    const assistantContent = stripControlBlock(rawResponse);
    visibleResponse = assistantContent;
    const control = parseControlBlock(rawResponse);
    let finalStatus: ConversationMessage['status'] = errorViewModel ? 'error' : 'complete';
    let traceStatus: ConversationReasoningTrace['status'] = errorViewModel ? 'error' : 'complete';

    commitAssistantMessage('message_patched', {
      content: `${visibleResponse}${systemAppendix}`,
      reasoningTrace: upsertTraceStep(assistantMessage.reasoningTrace, 'cowork-route', {
        status: 'complete',
        summary: '上下文检查完成。',
        completedAt: nowMs(),
      }),
    });

    if (abortController.signal.aborted) {
      this.clearActiveTurn(assistantMessage.turnId, abortController);
      return;
    }

    const effectiveMessage = resolveTaskFileContext(input.rawMessage).effectiveMessage;
    if (!input.context.projectId && EXECUTE_PATTERN.test(effectiveMessage)) {
      const boundaryReply = '我可以先帮你梳理问题，不过正式调试要先选一个项目。选好项目后，你可以继续描述现象，或者直接打开一个 .rdc capture。';
      commitAssistantMessage('message_completed', {
        status: 'complete',
        content: boundaryReply,
        reasoningTrace: finalizeTrace(
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
        ),
      });
      this.clearActiveTurn(assistantMessage.turnId, abortController);
      return;
    }

    if ((control?.intent === 'execute' || EXECUTE_PATTERN.test(effectiveMessage)) && control?.safe_to_start) {
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
          const workflowResult = await debuggerRuntime.requestStartFromConversation({
            source: 'conversation',
            message: assistantMessage,
            projectId: input.context.projectId,
            sessionId: input.context.session?.sessionId,
            turnId: assistantMessage.turnId,
            mode: 'debugger',
            goal: input.rawMessage,
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
      reasoningTrace: finalizeTrace(
        upsertTraceStep(assistantMessage.reasoningTrace, 'cowork-reply', {
          status: errorViewModel ? 'error' : 'complete',
          summary: errorViewModel ? '协作回复生成失败，已降级到本地兜底回复。' : '协作回复已完成。',
          completedAt: nowMs(),
        }),
        traceStatus,
        finalStatus === 'error' ? '回复失败' : '回复已完成',
      ),
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
}

export const conversationService = new ConversationService();
