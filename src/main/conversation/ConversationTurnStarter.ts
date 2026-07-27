import type {
  ConversationAttachmentInput,
  ConversationMessage,
  ConversationSendRequest,
  ConversationTurnResult,
} from '@shared/types/conversation';
import type { AppMode, ExecutableAppMode, SessionAttachmentRecord } from '@shared/types/session';
import type { AgentRole } from '@shared/types/agent';
import type { ConversationTurnControls } from '@shared/types/modelCapability';
import type { ConversationBranchState } from '@shared/types/conversationBranch';
import { ROOT_BRANCH_ID } from '@shared/types/conversationBranch';
import { generateEventId, nowMs } from '@shared/utils/id';
import { settingsService } from '../settings/SettingsService';
import { agentOrchestrator } from '../workflow/debugger/AgentOrchestrator';
import { planEffectiveModelRequest, resolveEffectiveModel } from '../settings/EffectiveModelResolver';
import { loadProviderSurface } from '../provider-catalog/ProviderCatalogRegistry';
import { resolveAgentRouteCapability } from '../agent-runtime/capabilities/RouteCapabilityResolver';
import { storageAdapter } from '../sessions/StorageAdapter';
import { traceService } from '../agent-trace/TraceService';
import { createDefaultBranchState, resolveVisibleConversationMessages } from './ConversationBranchResolver';
import { createDraftWorkTrace, finalizeTrace } from './ConversationWorkTrace';
import { materializeAgentUserInput, resolvePendingAttachmentDescriptors } from './ConversationAttachmentMaterializer';
import type {
  ConversationBranchTurnContext,
  PreparedConversationPrompt,
  ResolvedConversationContext,
} from './ConversationRoutePreflight';
import {
  createConversationMessage,
  isActiveRun,
  redactTechnicalMessage,
  resolveAgentRoutePreflight,
  resolveConversationAgentId,
  resolveEnabledAgentDefinition,
} from './ConversationRoutePreflight';
import type { CompleteProfileTurnInput } from './ConversationTurnRunner';

export interface ConversationTurnStarterHost {
  getPreparingRequestByRequestId(requestId: string): {
    requestId: string;
    controller: AbortController;
    phase: 'preparing' | 'committing';
    scopeKey: string;
    cancelAfterCommit: boolean;
    credentialHandle?: string;
    credentialLeaseTransferred: boolean;
  } | undefined;
  prepareConversationPrompt(input: import('./ConversationPromptPreparer').PrepareConversationPromptInput): PreparedConversationPrompt;
  persistConversationSnapshot(sessionId: string | null | undefined, message: ConversationMessage): Error | null;
  publishConversationTrace(traceSessionId: string, messages: ConversationMessage[], persistedSessionId?: string | null): void;
  ephemeralTraceSessionId(turnId: string): string;
  getPendingHandoff(sessionId: string): { toProfile: AgentRole; prompt: string } | undefined;
  deletePendingHandoff(sessionId: string): void;
}

function executableRunMode(agentId: AgentRole): ExecutableAppMode {
  if (agentId === 'analyzer') return 'analyzer';
  if (agentId === 'optimizer') return 'optimizer';
  return 'debugger';
}

export async function startProfileTurn(
  host: ConversationTurnStarterHost,
  onCompleteProfileTurn: (input: CompleteProfileTurnInput) => Promise<void>,
  context: ResolvedConversationContext,
  requestedMode: AppMode,
  requestedAgentId: string | null,
  rawMessage: string,
  pendingAttachments: ConversationAttachmentInput[],
  preloadSkillIds: string[] = [],
  branchContext?: ConversationBranchTurnContext,
  requestTurnControls?: ConversationTurnControls,
  requestId: string = generateEventId('request'),
  preparationController: AbortController = new AbortController(),
  configurationCommit?: ConversationSendRequest['configurationCommit'],
): Promise<ConversationTurnResult> {
  const pendingHandoff = context.session
    ? host.getPendingHandoff(context.session.sessionId)
    : undefined;
  const handoffProfile = pendingHandoff && resolveEnabledAgentDefinition(pendingHandoff.toProfile)
    ? pendingHandoff.toProfile
    : null;
  const effectiveMessage = pendingHandoff
    ? `${pendingHandoff.prompt}\n\n---\nUser message: ${rawMessage}`
    : rawMessage;
  const conversationAgentId = handoffProfile
    ?? resolveConversationAgentId(requestedMode, requestedAgentId);
  const turnId = generateEventId('turn');
  const throwIfPreparationCancelled = () => {
    if (preparationController.signal.aborted) {
      throw new Error('REQUEST_CANCELLED: request preparation was cancelled.');
    }
  };

  throwIfPreparationCancelled();
  if (configurationCommit?.agentId && configurationCommit.agentId !== conversationAgentId) {
    throw new Error('AGENT_COMMIT_NOT_FOUND: the committed Agent does not match the selected route.');
  }
  if (configurationCommit?.agentCommitHash) {
    const latestCommit = await settingsService.getAgentDefinitionCommit(conversationAgentId);
    if (!latestCommit || latestCommit.commitHash !== configurationCommit.agentCommitHash) {
      throw new Error('AGENT_COMMIT_NOT_FOUND: the selected Agent definition changed before preflight.');
    }
  }
  throwIfPreparationCancelled();

  const configuredRoute = settingsService.getAll().llm.agentRoutes.find((entry) => entry.agentId === conversationAgentId);
  if (configuredRoute?.providerId) {
    const surface = await loadProviderSurface(configuredRoute.providerId);
    if (!surface) throw new Error(`PROVIDER_UNAVAILABLE: ${configuredRoute.providerId} is not in the compiled Catalog.`);
  }
  throwIfPreparationCancelled();

  let routePreflight = resolveAgentRoutePreflight(conversationAgentId);
  if (!routePreflight.ok) {
    const code = routePreflight.diagnostic.code === 'CONVERSATION_LLM_PROVIDER_UNAVAILABLE'
      ? 'PROVIDER_UNAVAILABLE'
      : 'MODEL_UNAVAILABLE';
    throw new Error(`${code}: ${routePreflight.diagnostic.userMessage}`);
  }
  if (configurationCommit?.providerId && configurationCommit.providerId !== routePreflight.providerId) {
    throw new Error('PROVIDER_UNAVAILABLE: the committed Provider does not match the selected Agent route.');
  }
  if (configurationCommit?.providerCommitHash) {
    const providerCommit = await settingsService.getProviderDefinitionCommit(routePreflight.providerId);
    if (!providerCommit || providerCommit.commitHash !== configurationCommit.providerCommitHash) {
      throw new Error('PROVIDER_UNAVAILABLE: the Provider configuration changed before preflight.');
    }
  }
  const credentialHandle = await agentOrchestrator.refreshProviderRuntimeCredentials(routePreflight.providerId);
  const credentialRequestState = host.getPreparingRequestByRequestId(requestId);
  if (credentialRequestState) credentialRequestState.credentialHandle = credentialHandle;
  throwIfPreparationCancelled();
  routePreflight = resolveAgentRoutePreflight(conversationAgentId);
  if (!routePreflight.ok) {
    const code = routePreflight.diagnostic.code === 'CONVERSATION_LLM_PROVIDER_UNAVAILABLE'
      ? 'PROVIDER_UNAVAILABLE'
      : 'MODEL_UNAVAILABLE';
    throw new Error(`${code}: ${routePreflight.diagnostic.userMessage}`);
  }

  const settings = settingsService.getAll();
  const effectiveModel = resolveEffectiveModel(
    routePreflight.providerId,
    routePreflight.modelId,
    settings,
  );
  if (!effectiveModel) {
    throw new Error(`MODEL_UNAVAILABLE: ${routePreflight.providerId}/${routePreflight.modelId}`);
  }
  if (
    configurationCommit?.providerCatalogRevision
    && effectiveModel.catalogRevision !== configurationCommit.providerCatalogRevision
  ) {
    throw new Error('MODEL_UNAVAILABLE: the effective Provider catalog changed before preflight.');
  }
  if (configurationCommit?.routeRevision && effectiveModel.routeRevision !== configurationCommit.routeRevision) {
    throw new Error('MODEL_UNAVAILABLE: the selected model route changed before preflight.');
  }
  const planning = planEffectiveModelRequest({
    providerId: routePreflight.providerId,
    modelId: routePreflight.modelId,
    settings,
    controls: {
      ...(context.session?.turnControls ?? {}),
      ...(requestTurnControls ?? {}),
    },
  });
  if (!planning.ok) throw new Error(`${planning.code}: ${planning.message}`);
  const plannedRouteCapability = resolveAgentRouteCapability(
    settings.llm.providers.find((entry) => entry.id === routePreflight.providerId),
    routePreflight.modelId,
    effectiveModel,
    planning.plan,
  );
  if (
    configurationCommit?.providerCatalogRevision
    && planning.plan.catalogRevision !== configurationCommit.providerCatalogRevision
  ) {
    throw new Error('MODEL_UNAVAILABLE: the frozen RequestPlan catalog revision does not match the committed selection.');
  }
  // configurationCommit.routeRevision identifies the renderer-selected model and
  // was verified against effectiveModel above. A model-switch binding (for
  // example Kimi Fast) intentionally gives the frozen RequestPlan a different
  // effective route revision, so comparing those two revisions would reject a
  // valid canonical-model -> internal-target plan.
  const pendingAttachmentDescriptors = await resolvePendingAttachmentDescriptors(pendingAttachments);
  throwIfPreparationCancelled();
  const preparedUserInput = await materializeAgentUserInput(
    effectiveMessage,
    pendingAttachmentDescriptors,
    plannedRouteCapability.visionInputMode,
    false,
  );
  const preparedPrompt = host.prepareConversationPrompt({
    context,
    agentId: conversationAgentId,
    routePreflight: { ...routePreflight, routeCapability: plannedRouteCapability },
    requestPlan: planning.plan,
    effectiveModel,
    attachmentPaths: pendingAttachmentDescriptors.map((attachment) => attachment.filePath),
    messageText: effectiveMessage,
    preloadSkillIds,
  });
  const preparedBranchState = branchContext?.branchState ?? (context.session
    ? storageAdapter.readConversationBranchState(context.session.sessionId)
    : null);
  const preparedBranchId = branchContext?.branchId
    ?? preparedBranchState?.activeLeafBranchId
    ?? ROOT_BRANCH_ID;
  const preparedTurn = await agentOrchestrator.prepareTurnContext({
    requestId,
    credentialHandle,
    turnId,
    agentId: conversationAgentId,
    content: preparedUserInput.content,
    imageTokenAdjustment: preparedUserInput.imageTokenAdjustment,
    providerId: routePreflight.providerId,
    selectedModelId: routePreflight.modelId,
    effectiveModel,
    routeCapability: plannedRouteCapability,
    requestPlan: planning.plan,
    turnControls: planning.controls,
    promptPlan: preparedPrompt.promptPlan,
    toolAllowlist: preparedPrompt.allowedToolNames,
    projectRootPath: preparedPrompt.projectRootPath,
    sessionId: context.session?.sessionId ?? null,
    visibleTurnIds: preparedPrompt.visibleTurnIds,
    activeBranchId: preparedBranchId,
    signal: preparationController.signal,
  });
  throwIfPreparationCancelled();
  const requestState = host.getPreparingRequestByRequestId(requestId);
  if (requestState) requestState.phase = 'committing';

  let workingSession = context.session;
  let stagedSessionCommit: ReturnType<typeof storageAdapter.beginStagedConversationSession> | null = null;
  let existingTurnCommit: ReturnType<typeof storageAdapter.beginExistingConversationTurnCommit> | null = null;
  let importedAttachments: SessionAttachmentRecord[] = [];
  let persistedHistoryBeforeCommit: ConversationMessage[] = [];
  let persistedBranchBeforeCommit: ConversationBranchState | null = null;
  let branchState: ConversationBranchState | null = null;
  let turnRunId: string | null = null;
  let userMessage: ConversationMessage;
  let assistantDraftMessage: ConversationMessage;
  try {
    const attachmentPaths = pendingAttachments.map((entry) => entry.sourcePath);
    if (!workingSession && context.projectId) {
      stagedSessionCommit = storageAdapter.beginStagedConversationSession(
        context.projectId,
        rawMessage.slice(0, 80),
        attachmentPaths,
        requestId,
        turnId,
      );
      workingSession = stagedSessionCommit.session;
      importedAttachments = stagedSessionCommit.attachments;
    } else if (workingSession) {
      existingTurnCommit = storageAdapter.beginExistingConversationTurnCommit(
        workingSession.sessionId,
        attachmentPaths,
        requestId,
        turnId,
      );
      importedAttachments = existingTurnCommit.attachments;
      persistedHistoryBeforeCommit = existingTurnCommit.beforeHistory;
      persistedBranchBeforeCommit = existingTurnCommit.beforeBranch;
    } else if (pendingAttachments.length > 0) {
      throw new Error('ATTACHMENT_SESSION_REQUIRED: select or create a project session before attaching files.');
    }
    const sessionIdForBranch = workingSession?.sessionId ?? null;
    branchState = branchContext?.branchState ?? (sessionIdForBranch
      ? persistedBranchBeforeCommit
      : null);
    if (sessionIdForBranch && !branchState) branchState = createDefaultBranchState(sessionIdForBranch);
    const branchId = branchContext?.branchId
      ?? branchState?.activeLeafBranchId
      ?? ROOT_BRANCH_ID;
    userMessage = createConversationMessage('user', rawMessage, {
      requestId,
      turnId,
      sessionId: sessionIdForBranch,
      projectId: context.projectId,
      runId: isActiveRun(context.currentRun) ? context.currentRun.runId : null,
      modeContext: requestedMode,
      attachments: importedAttachments,
      status: 'complete',
      branchId,
      forkId: branchContext?.forkId,
      variantIndex: branchContext?.variantIndex,
      preparedContext: preparedTurn.summary,
    });
    assistantDraftMessage = createConversationMessage('assistant', '', {
      requestId,
      turnId,
      sessionId: sessionIdForBranch,
      projectId: context.projectId,
      runId: isActiveRun(context.currentRun) ? context.currentRun.runId : null,
      modeContext: requestedMode,
      agentId: conversationAgentId,
      status: 'streaming',
      workTrace: createDraftWorkTrace(),
      branchId,
      preparedContext: preparedTurn.summary,
    });
    if (sessionIdForBranch && branchState && branchContext) {
      const nextBranchState = structuredClone(branchState);
      const fork = nextBranchState.forks.find((entry) => entry.forkId === branchContext.forkId);
      if (!fork || fork.branches.some((entry) => entry.branchId === branchId)) {
        throw new Error('Conversation branch state changed before the new variant was committed.');
      }
      fork.branches.push({
        branchId,
        parentBranchId: branchContext.parentBranchId,
        variantIndex: branchContext.variantIndex,
        anchorUserMessageId: userMessage.id,
        rootTurnId: turnId,
      });
      fork.activeBranchId = branchId;
      nextBranchState.activeLeafBranchId = branchId;
      branchState = nextBranchState;
    }
    if (sessionIdForBranch) {
      const committedHistory = [...persistedHistoryBeforeCommit, userMessage, assistantDraftMessage];
      if (stagedSessionCommit) {
        workingSession = storageAdapter.commitStagedConversationSession(
          stagedSessionCommit,
          committedHistory,
          branchState,
        );
      } else if (existingTurnCommit) {
        storageAdapter.commitExistingConversationTurn(existingTurnCommit, committedHistory, branchState);
      }
    }

    // Every persisted conversation turn receives a durable run before the
    // agent starts. This is the sole owner for explicit user Outputs; no
    // renderer or action-payload fallback is allowed to invent an output.
    if (workingSession) {
      const createdRun = await storageAdapter.createRun({
        caseId: workingSession.sessionId,
        sessionId: workingSession.sessionId,
        turnId,
        capturePaths: [],
        mode: executableRunMode(conversationAgentId),
        goal: effectiveMessage,
        status: 'running',
      });
      turnRunId = createdRun.runId;
      userMessage = { ...userMessage, runId: turnRunId };
      assistantDraftMessage = { ...assistantDraftMessage, runId: turnRunId };
      storageAdapter.appendConversationMessage(workingSession.sessionId, userMessage);
      storageAdapter.appendConversationMessage(workingSession.sessionId, assistantDraftMessage);
    }
  } catch (error) {
    try {
      if (stagedSessionCommit) storageAdapter.rollbackStagedConversationSession(stagedSessionCommit);
      if (existingTurnCommit) storageAdapter.rollbackExistingConversationTurn(existingTurnCommit);
    } catch (rollbackError) {
      console.error(`[ConversationService] Failed to roll back turn ${turnId}:`, rollbackError);
    }
    throw new Error(`TURN_COMMIT_FAILED: ${redactTechnicalMessage(error)}`);
  }
  if (pendingHandoff && context.session) {
    host.deletePendingHandoff(context.session.sessionId);
  }
  let visibleMessages = workingSession?.sessionId && branchState
    ? resolveVisibleConversationMessages(
        storageAdapter.readConversationHistory(workingSession.sessionId),
        branchState,
      )
    : [userMessage, assistantDraftMessage];
  const traceSessionId = workingSession?.sessionId ?? host.ephemeralTraceSessionId(turnId);
  let tracePresentation = await traceService.buildConversationPresentation(
    traceSessionId,
    [userMessage, assistantDraftMessage],
  );
  const cancelAfterCommit = host.getPreparingRequestByRequestId(requestId)?.cancelAfterCommit === true;
  if (cancelAfterCommit) {
    assistantDraftMessage.status = 'stopped';
    assistantDraftMessage.updatedAt = nowMs();
    assistantDraftMessage.workTrace = finalizeTrace(
      assistantDraftMessage.workTrace,
      'stopped',
      'Request stopped after commit.',
    );
    const persistError = host.persistConversationSnapshot(workingSession?.sessionId ?? null, assistantDraftMessage);
    if (persistError) console.error(`[ConversationService] Failed to persist cancelled turn ${turnId}:`, persistError);
    visibleMessages = workingSession?.sessionId && branchState
      ? resolveVisibleConversationMessages(
          storageAdapter.readConversationHistory(workingSession.sessionId),
          branchState,
        )
      : [userMessage, assistantDraftMessage];
    tracePresentation = await traceService.buildConversationPresentation(
      traceSessionId,
      [userMessage, assistantDraftMessage],
    );
  }
  // The turn-start projection is published by host.publishConversationTrace below: for a
  // persisted session it resolves the full traceService.getSession projection (including the
  // buildRightPanel progress/artifacts/context payload). Publishing the lightweight
  // conversation-only presentation here first would overwrite the previous turn's full
  // projection and blank the right-rail sections until the full projection arrives.
  host.publishConversationTrace(traceSessionId, [userMessage, assistantDraftMessage], workingSession?.sessionId ?? null);

  if (!cancelAfterCommit) {
    const runningRequestState = host.getPreparingRequestByRequestId(requestId);
    if (runningRequestState) runningRequestState.credentialLeaseTransferred = true;
    void onCompleteProfileTurn({
      context: {
        ...context,
        session: workingSession,
        currentRun: workingSession && turnRunId
          ? storageAdapter.listRuns(workingSession.sessionId).find((run) => run.runId === turnRunId) ?? null
          : context.currentRun,
      },
      requestedMode,
      requestedAgentId: conversationAgentId,
      rawMessage: effectiveMessage,
      importedAttachments,
      userMessage,
      assistantDraftMessage,
      requestId,
      routePreflight,
      planning,
      preparedPrompt,
      preparedTurn,
    }).catch((error) => {
      agentOrchestrator.releaseProviderRuntimeCredentials(preparedTurn.runtime.credentialHandle);
      console.error(`[ConversationService] Background turn ${turnId} failed before terminal cleanup:`, error);
    });
  }

  return {
    requestId,
    session: workingSession,
    mode: 'talk',
    userMessage,
    assistantDraftMessage,
    messages: visibleMessages,
    branchState: branchState ?? null,
    executionTransition: { action: 'none' },
    runUpdate: null,
    tracePresentation,
    errorViewModel: null,
    preparedContext: preparedTurn.summary,
  };
}
