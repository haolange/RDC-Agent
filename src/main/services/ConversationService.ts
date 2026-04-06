import fs from 'fs';
import path from 'path';
import type { ConversationControl, ConversationMessage, ConversationSendRequest, ConversationTurnResult } from '@shared/types/conversation';
import type { ProjectInputRecord, RunSummary, SessionRecord } from '@shared/types/session';
import type { ReplayDeviceEntry } from '@shared/types/device';
import { generateEventId, nowMs } from '@shared/utils/id';
import { agentOrchestrator } from './AgentOrchestrator';
import { debugWorkflowService } from './DebugWorkflowService';
import { replayDeviceService } from './ReplayDeviceService';
import { rdxSessionService } from '../index';
import { settingsService } from './SettingsService';
import { storageAdapter } from './StorageAdapter';

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

const EXECUTE_PATTERN = /开始|启动|执行|正式分析|直接分析|现在分析|run\b|start\b|debug\b|analy[sz]e\b|帮我调试|请调试|开始调试|开始分析/i;
const TASK_FILE_PATTERN = /([A-Za-z]:[\\/][^\r\n"]+\.(txt|md))/i;

function trimPathLabel(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || value;
}

function makeConversationMessage(
  role: ConversationMessage['role'],
  content: string,
  options: {
    sessionId?: string | null;
    projectId?: string | null;
    runId?: string | null;
    agentId?: ConversationMessage['agentId'];
  },
): ConversationMessage {
  return {
    id: generateEventId(role === 'user' ? 'msgu' : role === 'assistant' ? 'msga' : 'msgs'),
    sessionId: options.sessionId ?? null,
    projectId: options.projectId ?? null,
    runId: options.runId ?? null,
    role,
    agentId: options.agentId,
    content,
    createdAt: nowMs(),
  };
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

function buildCoworkPrompt(context: ResolvedConversationContext, history: ConversationMessage[], message: string): string {
  const resolvedTaskFile = resolveTaskFileContext(message);
  const recentHistory = history.slice(-6).map((entry) => ({
    role: entry.role,
    content: entry.content,
  }));

  return JSON.stringify({
    user_message: message,
    effective_user_message: resolvedTaskFile.effectiveMessage,
    task_file_path: resolvedTaskFile.taskFilePath,
    task_file_content: resolvedTaskFile.taskFileContent,
    current_project_id: context.projectId,
    current_session_id: context.session?.sessionId ?? null,
    active_run_id: context.currentRun?.runId ?? null,
    opened_capture: context.openedCapturePath,
    project_inputs: context.projectInputs.slice(0, 8).map((entry) => entry.fileName),
    recent_history: recentHistory,
  }, null, 2);
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

function buildCoworkSystemPrompt(): string {
  return [
    '你是 RDC Debugger，一个面向 RenderDoc 调试场景的 Cowork Agent。',
    '要求：',
    '1. 始终先用自然中文正常回答用户，不要像审批流或工单流。',
    '2. 如果用户问通用知识、产品能力、技术概念，直接回答，不要强行往调试执行上拐。',
    '3. 没有正式进入调试 run 前，不要假装自己已经分析过 capture。',
    '4. 只有当用户明确表达“现在开始正式调试/执行分析”，并且条件足够时，才把 intent 标成 execute。',
    '5. 回复正文结束后，必须额外附加一个 <control>{...}</control> 块，且 control JSON 只能包含字段：intent, safe_to_start, needs_project, needs_capture, needs_target_capture, needs_route, reason。',
    '6. 如果你不确定，就把 intent 设为 talk 或 intake，safe_to_start 设为 false。',
    '7. 控制块不要在正文里解释给用户。',
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
      reason: '我可以先帮你梳理问题，但正式分析需要一个 .rdc capture。你可以先描述现象，或直接打开一个 capture。',
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
      return '你好，我是 RDC Debugger。当前核心模型链路还没准备好，所以我暂时只能做基础接待；等你配置好 `rdc-debugger` 的 provider / model route 后，我再继续正常协作。';
    }
    if (EXECUTE_PATTERN.test(message)) {
      return '当前调试链路还没绑定可用模型，所以我不能开始正式执行；不过我可以先帮你确认问题范围和所需 capture。';
    }
    return '我现在拿不到核心模型回复，所以没法像正常 Cowork Agent 一样继续对话。你先检查 `rdc-debugger` 的 provider / model route。';
  }

  return '我刚才没能稳定产出这轮对话回复。你可以重试一次；如果问题持续，优先检查当前 `rdc-debugger` 的模型链路。';
}

function buildWorkflowUpgradeReply(result: Awaited<ReturnType<typeof debugWorkflowService.startPlan>>): string {
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
      return '我可以先帮你梳理问题，但正式分析需要一个 .rdc capture。你可以先描述现象，或直接打开一个 capture。';
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

export class ConversationService {
  async getHistory(sessionId: string): Promise<ConversationMessage[]> {
    return storageAdapter.readConversationHistory(sessionId);
  }

  async sendMessage(input: ConversationContextInput): Promise<ConversationTurnResult> {
    const context = await this.resolveContext(input);
    const userMessage = makeConversationMessage('user', input.message.trim(), {
      sessionId: context.session?.sessionId ?? null,
      projectId: context.projectId,
      runId: context.currentRun?.runId ?? null,
    });

    if (context.session) {
      storageAdapter.appendConversationMessage(context.session.sessionId, userMessage);
    }

    if (context.currentRun && ['planning', 'awaiting_input', 'awaiting_approval', 'queued', 'running', 'stopping'].includes(context.currentRun.status)) {
      return this.handleActiveDebugTurn(context, userMessage);
    }

    return this.handleCoworkTurn(context, userMessage, input.message.trim());
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

  private async handleActiveDebugTurn(
    context: ResolvedConversationContext,
    userMessage: ConversationMessage,
  ): Promise<ConversationTurnResult> {
    let assistantContent: string;

    try {
      assistantContent = await agentOrchestrator.sendMessage('rdc-debugger', userMessage.content, {
        caseId: context.session?.sessionId,
        runId: context.currentRun?.runId,
        sessionId: context.session?.sessionId,
      });
    } catch (error) {
      assistantContent = error instanceof Error
        ? `我刚才处理这条消息时失败了：${error.message}`
        : '我刚才处理这条消息时失败了。';
    }

    const assistantMessage = makeConversationMessage('assistant', assistantContent, {
      sessionId: context.session?.sessionId ?? null,
      projectId: context.projectId,
      runId: context.currentRun?.runId ?? null,
      agentId: 'rdc-debugger',
    });

    if (context.session) {
      storageAdapter.appendConversationMessage(context.session.sessionId, assistantMessage);
    }

    return {
      session: context.session,
      mode: 'active_debug',
      userMessage,
      assistantMessage,
      executionTransition: { action: 'none' },
      runUpdate: context.currentRun,
    };
  }

  private async handleCoworkTurn(
    context: ResolvedConversationContext,
    userMessage: ConversationMessage,
    rawMessage: string,
  ): Promise<ConversationTurnResult> {
    const taskFileContext = resolveTaskFileContext(rawMessage);
    const effectiveMessage = taskFileContext.effectiveMessage;
    let workingSession = context.session;
    if (!workingSession && context.projectId) {
      workingSession = storageAdapter.createSession(context.projectId, rawMessage.slice(0, 80));
      storageAdapter.appendConversationMessage(workingSession.sessionId, userMessage);
      userMessage.sessionId = workingSession.sessionId;
    }

    const history = workingSession ? storageAdapter.readConversationHistory(workingSession.sessionId) : [];
    let assistantContent = '';
    let control: ConversationControl | null = null;
    let errorViewModel: ConversationTurnResult['errorViewModel'] = null;

    try {
      const response = await agentOrchestrator.sendCoworkMessage(
        'rdc-debugger',
        buildCoworkPrompt({
          ...context,
          session: workingSession,
        }, history, rawMessage),
        {
          sessionId: workingSession?.sessionId,
          systemPrompt: buildCoworkSystemPrompt(),
          maxTokens: 1200,
          temperature: 0.35,
        },
      );
      assistantContent = stripControlBlock(response);
      control = parseControlBlock(response);
    } catch (error) {
      assistantContent = createFallbackAssistantReply(effectiveMessage, {
        ...context,
        session: workingSession,
      });
      errorViewModel = {
        code: 'CONVERSATION_LLM_UNAVAILABLE',
        message: assistantContent,
        technicalMessage: error instanceof Error ? error.message : String(error),
      };
    }

    let mode: ConversationTurnResult['mode'] = control?.intent === 'intake' ? 'intake' : 'talk';
    let executionTransition: ConversationTurnResult['executionTransition'] = { action: 'none' };
    let runUpdate: RunSummary | null = null;
    let debugPlanSummary: ConversationTurnResult['debugPlanSummary'];
    let pendingQuestions: ConversationTurnResult['pendingQuestions'];
    let uiHints: ConversationTurnResult['uiHints'] = {};

    if ((control?.intent === 'execute' || EXECUTE_PATTERN.test(effectiveMessage)) && control?.safe_to_start) {
      if (!context.projectId) {
        mode = 'intake';
        assistantContent = '我可以先帮你梳理问题，不过正式调试要先选一个项目。选好项目后，你可以继续描述现象，或者直接打开一个 .rdc capture。';
        uiHints.highlightProjectPicker = true;
      } else {
        const captureGuard = resolveCaptureGuards(effectiveMessage, {
          ...context,
          session: workingSession,
        });

        if (!captureGuard.ready) {
          mode = 'intake';
          assistantContent = captureGuard.reason || assistantContent;
          uiHints.highlightCaptureLibrary = true;
        } else {
          const workflowResult = await debugWorkflowService.startPlan({
            projectId: context.projectId,
            sessionId: workingSession?.sessionId,
            mode: 'debugger',
            goal: rawMessage,
            replayDevice: context.replayDevice,
          });

          mode = 'execute_upgrade';
          assistantContent = assistantContent
            ? `${assistantContent}\n\n${buildWorkflowUpgradeReply(workflowResult)}`
            : buildWorkflowUpgradeReply(workflowResult);
          const hasBlockingPlanFailure = Boolean(workflowResult.debugPlanSummary?.blockers?.length);
          debugPlanSummary = hasBlockingPlanFailure ? null : (workflowResult.debugPlanSummary ?? null);
          pendingQuestions = hasBlockingPlanFailure ? null : (workflowResult.pendingQuestions ?? null);
          uiHints.showPlanIntake = !hasBlockingPlanFailure && Boolean(debugPlanSummary || pendingQuestions);
          executionTransition = workflowResult.success && workflowResult.runId && !hasBlockingPlanFailure
            ? {
                action: 'started_run',
                runId: workflowResult.runId,
                sessionId: workflowResult.sessionId,
              }
            : { action: 'none' };
          if (workflowResult.sessionId) {
            runUpdate = hasBlockingPlanFailure ? null : storageAdapter.getLatestRun(workflowResult.sessionId);
            if (!workingSession) {
              workingSession = storageAdapter.readSession(workflowResult.sessionId);
            }
          }
        }
      }
    } else if (control?.intent === 'intake') {
      mode = 'intake';
      uiHints.highlightCaptureLibrary = control.needs_capture || control.needs_target_capture;
      uiHints.highlightProjectPicker = control.needs_project;
      uiHints.highlightSettingsRoute = control.needs_route;
    }

    const assistantMessage = makeConversationMessage('assistant', assistantContent, {
      sessionId: workingSession?.sessionId ?? null,
      projectId: context.projectId,
      runId: runUpdate?.runId ?? null,
      agentId: 'rdc-debugger',
    });

    if (workingSession) {
      storageAdapter.appendConversationMessage(workingSession.sessionId, assistantMessage);
    }

    return {
      session: workingSession,
      mode,
      userMessage: {
        ...userMessage,
        sessionId: workingSession?.sessionId ?? userMessage.sessionId,
      },
      assistantMessage,
      executionTransition,
      runUpdate,
      debugPlanSummary,
      pendingQuestions,
      uiHints,
      errorViewModel,
    };
  }
}

export const conversationService = new ConversationService();
