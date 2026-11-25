import path from 'node:path';
import { formatAgentManifestDiagnostic } from '@shared/utils/agentManifestDiagnostic';
import { ROOT_BRANCH_ID } from '@shared/types/conversationBranch';
import { generateEventId, nowMs } from '@shared/utils/id';
import { conversationTurnIds } from '@shared/conversation/conversationTurnIds';
import { resolveAgentWriteTarget } from '@shared/types/agentManifest';
import { AppError } from '@shared/errors/appError';
import { settingsService } from '../settings/settings-core/SettingsService';
import { agentOrchestrator } from '../agent-runtime/orchestration/agentRuntimeRoot';
import { awaitFirstCatalogLoad, planEffectiveModelRequest, resolveEffectiveModel } from '../settings/provider-catalog/EffectiveModelResolver';
import { resolveCompactionPercentForProject } from '../agent-runtime/context/compactionPercent';
import { loadProviderSurface } from '../provider-catalog/ProviderCatalogRegistry';
import { resolveAgentRouteCapability } from '../agent-runtime/capabilities/RouteCapabilityResolver';
import { conversationHistoryStore, projectWorkspaceStore, sessionRecordStore } from '../sessions/store/sessionStores';
import { traceService } from '../agent-trace/TraceService';
import { createDefaultBranchState, resolveVisibleConversationMessages } from '../sessions/store/ConversationBranchResolver';
import { createDraftWorkTrace, finalizeTrace } from '../agent-runtime/workTrace/ConversationWorkTrace';
import { materializeAgentUserInput, resolvePendingAttachmentDescriptors } from '../agent-runtime/attachments/ConversationAttachmentMaterializer';
import { resolveEnabledAgentDefinition } from '../settings/agent-manifests/effectiveAgentSnapshot';
import { createConversationMessage, isActiveRun, recordOverlayProfileDiagnostics, redactTechnicalMessage, resolveAgentRoutePreflight, resolveConversationAgentId } from './ConversationRoutePreflight';
import { assertAgentReasoningHonored, conversationTurnControlInput } from './ConversationTurnControls';
import {
  createContinuationDropNotice,
  shouldAnnounceContinuationDrop,
} from './ConversationContinuationNotice';
import { prepareConversationPrompt } from './ConversationPromptPreparer';
import { completeProfileTurn, type ActiveConversationTurns, type ConversationTurnOutput } from './ConversationTurnRunner';
import type { PolicyBudgetState } from '../agent-runtime/orchestration/TurnCoordinator';
import type { ConversationBranchState } from '@shared/types/conversationBranch';
import type { ConversationTurnControls } from '@shared/types/modelCapability';
import type { EffectiveModel, RequestPlan } from '@shared/types/providerCapability';
import type { AgentRouteCapability } from '@shared/types/agentRuntime';
import type { EffectiveAgentProfile } from '../settings/agent-manifests/agentRuntimeTypes';
import type { RunSummary, SessionAttachmentRecord, SessionRecord } from '@shared/types/session';
import type { PreparedAgentTurnContext } from '../agent-runtime/orchestration/orchestratorTypes';
import type {
  ConversationAttachmentInput,
  ConversationMessage,
  ConversationSendRequest,
  ConversationTurnResult,
} from '@shared/types/conversation';
import type {
  AgentRoutePreflightOk,
  ConversationBranchTurnContext,
  PreparedConversationPrompt,
  ResolvedConversationContext,
} from './ConversationRoutePreflight';

/** The conversation's requests still preparing (ConversationService). */
export interface PreparingConversationRequests {
  getPreparingRequestByRequestId(requestId: string): {
    requestId: string;
    controller: AbortController;
    phase: 'preparing' | 'committing';
    scopeKey: string;
    cancelAfterCommit: boolean;
    credentialHandle?: string;
    credentialLeaseTransferred: boolean;
  } | undefined;
}

/** One user message to prepare, commit as a turn and start: who runs it, on which context, with which inputs. */
export interface ProfileTurnStart {
  requests: PreparingConversationRequests;
  turns: ActiveConversationTurns;
  output: ConversationTurnOutput;
  context: ResolvedConversationContext;
  requestedProfileId: string | null;
  requestedAgentId: string | null;
  rawMessage: string;
  pendingAttachments: ConversationAttachmentInput[];
  preloadSkillIds?: string[];
  branchContext?: ConversationBranchTurnContext;
  requestTurnControls?: ConversationTurnControls;
  requestId?: string;
  preparationController?: AbortController;
  configurationCommit?: ConversationSendRequest['configurationCommit'];
  requestFingerprint?: string;
  excludeTurnId?: string;
  policyBudget?: PolicyBudgetState;
}

/** The start with its defaults applied and the Agent it runs. */
interface TurnStart extends ProfileTurnStart {
  requestId: string;
  preparationController: AbortController;
  preloadSkillIds: string[];
  pendingProjectRootPath: string | null;
  conversationAgentId: string;
  turnIds: ReturnType<typeof conversationTurnIds>;
  effectiveSnapshot: EffectiveAgentProfile;
}

/** The frozen route, model and request plan. */
interface TurnRoute {
  routePreflight: AgentRoutePreflightOk;
  credentialHandle: string;
  effectiveModel: EffectiveModel;
  planning: { ok: true; plan: RequestPlan; controls: ConversationTurnControls; warnings: string[] };
  plannedRouteCapability: AgentRouteCapability;
}

/** The turn's attachments, planned against the session that will own them, and the materialized user input. */
interface TurnInput {
  pendingAttachmentDescriptors: Awaited<ReturnType<typeof resolvePendingAttachmentDescriptors>>;
  reservedSession: ReturnType<typeof sessionRecordStore.allocateStagedConversationSession> | null;
  plannedAttachmentRecords: SessionAttachmentRecord[];
  preparedUserInput: Awaited<ReturnType<typeof materializeAgentUserInput>>;
}

interface PreparedTurnRuntime {
  preparedPrompt: PreparedConversationPrompt;
  preparedTurn: PreparedAgentTurnContext;
}

/** What the commit wrote: the session, the turn's messages and branch state, and its run. */
interface CommittedTurn {
  workingSession: SessionRecord | null;
  importedAttachments: SessionAttachmentRecord[];
  branchState: ConversationBranchState | null;
  turnRunId: string | null;
  userMessage: ConversationMessage;
  assistantDraftMessage: ConversationMessage;
  continuationNotice: ConversationMessage | null;
}

/** Prepares, commits and starts one conversation turn in named phases. */
export async function startProfileTurn(start: ProfileTurnStart): Promise<ConversationTurnResult> {
  const turn = await resolveTurnAgent(start);
  const route = await resolveTurnRoute(turn);
  const input = await planTurnInput(turn, route);
  const runtime = await prepareTurnRuntime(turn, route, input);
  const committed = await commitTurn(turn, route, input, runtime);
  return startCommittedTurn(turn, route, runtime, committed);
}

function throwIfPreparationCancelled(turn: Pick<TurnStart, 'preparationController'>): void {
  if (turn.preparationController.signal.aborted) {
    throw new AppError('REQUEST_CANCELLED', 'request preparation was cancelled.');
  }
}

/** Which Agent runs the turn, checked against the Agent definition the renderer committed. */
async function resolveTurnAgent(start: ProfileTurnStart): Promise<TurnStart> {
  const { context, configurationCommit } = start;
  const preparationController = start.preparationController ?? new AbortController();
  const requestId = start.requestId ?? generateEventId('request');
  // Turn preparation is where edits made outside the app (secrets, Agent files, trust) are picked up.
  settingsService.revalidateExternalInputs();
  const pendingProjectRootPath = context.projectId
    ? projectWorkspaceStore.getProjectById(context.projectId)?.rootPath ?? null
    : null;
  const conversationAgentId = resolveConversationAgentId(start.requestedAgentId, start.requestedProfileId, pendingProjectRootPath);
  const turnIds = conversationTurnIds(requestId);
  throwIfPreparationCancelled({ preparationController });
  if (
    configurationCommit?.agentId
    && configurationCommit.agentId !== conversationAgentId
  ) {
    throw new AppError('AGENT_COMMIT_NOT_FOUND', 'the committed Agent does not match the selected route.');
  }
  const effectiveSnapshot = resolveEnabledAgentDefinition(conversationAgentId, pendingProjectRootPath);
  if (!effectiveSnapshot) {
    throw new AppError(
      'CONVERSATION_AGENT_UNAVAILABLE', `requested profile \`${conversationAgentId}\` is not enabled.`,
    );
  }
  if (configurationCommit?.agentCommitHash) {
    const writeTarget = resolveAgentWriteTarget(effectiveSnapshot, context.projectId);
    const latestCommit = await settingsService.getAgentDefinitionCommit({
      agentId: conversationAgentId,
      ...writeTarget,
    });
    if (!latestCommit || latestCommit.commitHash !== configurationCommit.agentCommitHash) {
      throw new AppError('AGENT_COMMIT_NOT_FOUND', 'the selected Agent definition changed before preflight.');
    }
  }
  throwIfPreparationCancelled({ preparationController });
  return {
    ...start,
    requestId,
    preparationController,
    preloadSkillIds: start.preloadSkillIds ?? [],
    pendingProjectRootPath,
    conversationAgentId,
    turnIds,
    effectiveSnapshot,
  };
}

/** The Agent route preflight, failing with the provider or model diagnostic and the overlay diagnostics. */
function requireRoutePreflight(turn: TurnStart, modelOverride: { providerId: string; modelId: string } | null): AgentRoutePreflightOk {
  const routePreflight = resolveAgentRoutePreflight(turn.conversationAgentId, undefined, modelOverride, turn.pendingProjectRootPath);
  if (!routePreflight.ok) {
    recordOverlayProfileDiagnostics(turn.context, turn.conversationAgentId, routePreflight.overlayDiagnostics, false);
    const overlay = routePreflight.overlayDiagnostics?.map(formatAgentManifestDiagnostic).join(' ') ?? '';
    const code = routePreflight.diagnostic.code === 'CONVERSATION_LLM_PROVIDER_UNAVAILABLE'
      ? 'PROVIDER_UNAVAILABLE'
      : 'MODEL_UNAVAILABLE';
    throw new Error(`${code}: ${routePreflight.diagnostic.userMessage}${overlay ? ` ${overlay}` : ''}`);
  }
  return routePreflight;
}

/**
 * The frozen route: the Provider surface and catalog are loaded, the committed Provider and model revisions are
 * verified, the runtime credentials are leased, and the request plan honours the Agent's reasoning level.
 */
async function resolveTurnRoute(turn: TurnStart): Promise<TurnRoute> {
  const { context, configurationCommit, effectiveSnapshot, preparationController } = turn;
  const modelOverride = context.session?.modelOverride
    ?? (configurationCommit?.providerId && configurationCommit.modelId
      ? { providerId: configurationCommit.providerId, modelId: configurationCommit.modelId }
      : null);
  const configuredRoute = effectiveSnapshot?.compiledRoute;
  const surfaceProviderId = modelOverride?.providerId ?? configuredRoute?.providerId;
  if (surfaceProviderId) {
    const surface = await loadProviderSurface(surfaceProviderId);
    if (!surface) throw new AppError('PROVIDER_UNAVAILABLE', `${surfaceProviderId} is not in the compiled Catalog.`);
    await awaitFirstCatalogLoad(surfaceProviderId, settingsService.providerConnections, preparationController.signal);
  }
  throwIfPreparationCancelled(turn);

  let routePreflight = requireRoutePreflight(turn, modelOverride);
  if (configurationCommit?.providerId && configurationCommit.providerId !== routePreflight.providerId) {
    throw new AppError('PROVIDER_UNAVAILABLE', 'the committed Provider does not match the selected Agent route.');
  }
  if (configurationCommit?.providerCommitHash) {
    const providerCommit = await settingsService.getProviderDefinitionCommit(routePreflight.providerId);
    if (!providerCommit || providerCommit.commitHash !== configurationCommit.providerCommitHash) {
      throw new AppError('PROVIDER_UNAVAILABLE', 'the Provider configuration changed before preflight.');
    }
  }
  const credentialHandle = await agentOrchestrator.refreshProviderRuntimeCredentials(routePreflight.providerId);
  const credentialRequestState = turn.requests.getPreparingRequestByRequestId(turn.requestId);
  if (credentialRequestState) credentialRequestState.credentialHandle = credentialHandle;
  throwIfPreparationCancelled(turn);
  routePreflight = requireRoutePreflight(turn, modelOverride);

  const providers = settingsService.providerConnections;
  const effectiveModel = resolveEffectiveModel(
    routePreflight.providerId,
    routePreflight.modelId,
    providers,
  );
  if (!effectiveModel) {
    throw new AppError('MODEL_UNAVAILABLE', `${routePreflight.providerId}/${routePreflight.modelId}`);
  }
  if (
    configurationCommit?.providerCatalogRevision
    && effectiveModel.catalogRevision !== configurationCommit.providerCatalogRevision
  ) {
    throw new AppError('MODEL_UNAVAILABLE', 'the effective Provider catalog changed before preflight.');
  }
  if (configurationCommit?.routeRevision && effectiveModel.routeRevision !== configurationCommit.routeRevision) {
    throw new AppError('MODEL_UNAVAILABLE', 'the selected model route changed before preflight.');
  }
  const requestedControls = conversationTurnControlInput(effectiveSnapshot.reasoningLevel, context.session?.turnControls, turn.requestTurnControls);
  const planning = planEffectiveModelRequest({
    providerId: routePreflight.providerId,
    modelId: routePreflight.modelId,
    providers,
    controls: requestedControls,
    compactionThresholdPercent: resolveCompactionPercentForProject(turn.pendingProjectRootPath),
  });
  if (!planning.ok) throw new Error(`${planning.code}: ${planning.message}`);
  assertAgentReasoningHonored(effectiveSnapshot.reasoningLevel, requestedControls, planning.plan.reasoningWire.selection);
  const plannedRouteCapability = resolveAgentRouteCapability(
    providers.get(routePreflight.providerId),
    routePreflight.modelId,
    effectiveModel,
    planning.plan,
  );
  if (
    configurationCommit?.providerCatalogRevision
    && planning.plan.catalogRevision !== configurationCommit.providerCatalogRevision
  ) {
    throw new AppError('MODEL_UNAVAILABLE', 'the frozen RequestPlan catalog revision does not match the committed selection.');
  }
  // configurationCommit.routeRevision identifies the renderer-selected model and
  // was verified against effectiveModel above. A model-switch binding (for
  // example Kimi Fast) intentionally gives the frozen RequestPlan a different
  // effective route revision, so comparing those two revisions would reject a
  // valid canonical-model -> internal-target plan.
  return { routePreflight, credentialHandle, effectiveModel, planning, plannedRouteCapability };
}

/** The turn's attachments are planned against the session that will own them before the user input is materialized. */
async function planTurnInput(turn: TurnStart, route: TurnRoute): Promise<TurnInput> {
  const { context, requestId, turnIds } = turn;
  const pendingAttachmentDescriptors = await resolvePendingAttachmentDescriptors(turn.pendingAttachments);
  throwIfPreparationCancelled(turn);
  const reservedSession = !context.session && context.projectId && pendingAttachmentDescriptors.length > 0
    ? sessionRecordStore.allocateStagedConversationSession(
      context.projectId,
      turn.rawMessage.slice(0, 80),
      requestId,
      turnIds.turnId,
    )
    : null;
  const classifications = pendingAttachmentDescriptors.map((attachment) => ({
    material: attachment.material, sourceHash: attachment.sourceHash,
    layer: attachment.layer,
    mimeType: attachment.mimeType,
    kind: attachment.kind,
    fileName: attachment.fileName,
    size: attachment.size,
  }));
  const plannedAttachmentRecords: SessionAttachmentRecord[] = pendingAttachmentDescriptors.length === 0
    ? []
    : context.session
      ? conversationHistoryStore.planAttachmentsForTurn(
        context.session,
        pendingAttachmentDescriptors.map((attachment) => attachment.filePath),
        sessionRecordStore.getSessionAttachmentsDir(context.session.sessionId),
        classifications,
      )
      : reservedSession
        ? conversationHistoryStore.planAttachmentsForTurn(
          reservedSession.session,
          pendingAttachmentDescriptors.map((attachment) => attachment.filePath),
          path.join(reservedSession.finalPath, 'attachments'),
          classifications,
        )
        : [];
  if (pendingAttachmentDescriptors.length > 0 && plannedAttachmentRecords.length === 0) {
    throw new AppError('ATTACHMENT_SESSION_REQUIRED', 'select or create a project session before attaching files.');
  }
  const plannedInputAttachments = pendingAttachmentDescriptors.map((attachment, index) => {
    const planned = plannedAttachmentRecords[index]!;
    return {
      material: planned.material, sourceHash: planned.sourceHash,
      attachmentId: planned.attachmentId,
      kind: planned.kind,
      layer: planned.layer ?? attachment.layer,
      fileName: planned.fileName,
      filePath: planned.filePath,
      readPath: attachment.filePath,
      mimeType: planned.mimeType,
      size: planned.size,
    };
  });
  const preparedUserInput = await materializeAgentUserInput(
    turn.rawMessage,
    plannedInputAttachments,
    route.plannedRouteCapability.visionInputMode,
    { includeImageData: false, contextBudgetTokens: route.planning.plan.contextBudgetTokens },
  );
  return { pendingAttachmentDescriptors, reservedSession, plannedAttachmentRecords, preparedUserInput };
}

/** The PromptPlan and the frozen runtime (prepareTurnContext); after this the request is committing. */
async function prepareTurnRuntime(turn: TurnStart, route: TurnRoute, input: TurnInput): Promise<PreparedTurnRuntime> {
  const { context, branchContext, conversationAgentId } = turn;
  const { routePreflight, planning, effectiveModel, plannedRouteCapability } = route;
  const { preparedUserInput } = input;
  const preparedPrompt = prepareConversationPrompt({
    context,
    agentId: conversationAgentId,
    routePreflight: { ...routePreflight, routeCapability: plannedRouteCapability },
    requestPlan: planning.plan,
    effectiveModel,
    attachmentPaths: input.pendingAttachmentDescriptors.map((attachment) => attachment.filePath),
    messageText: turn.rawMessage,
    preloadSkillIds: turn.preloadSkillIds,
    excludeTurnId: turn.excludeTurnId,
  });
  const preparedBranchState = branchContext?.branchState ?? (context.session
    ? conversationHistoryStore.readConversationBranchState(context.session.sessionId)
    : null);
  const preparedBranchId = branchContext?.branchId
    ?? preparedBranchState?.activeLeafBranchId
    ?? ROOT_BRANCH_ID;
  const preparedTurn = await agentOrchestrator.prepareTurnContext({
    requestId: turn.requestId,
    credentialHandle: route.credentialHandle,
    turnId: turn.turnIds.turnId,
    agentId: conversationAgentId,
    content: preparedUserInput.content,
    frozenUserContent: preparedUserInput.content,
    attachmentManifest: preparedUserInput.attachmentManifest,
    inlineTokenBudget: preparedUserInput.inlineTokenBudget,
    imageTokenAdjustment: preparedUserInput.imageTokenAdjustment,
    providerId: routePreflight.providerId,
    selectedModelId: routePreflight.modelId,
    effectiveModel,
    routeCapability: plannedRouteCapability,
    requestPlan: planning.plan,
    turnControls: planning.controls,
    promptPlan: preparedPrompt.promptPlan,
    effectiveProfile: preparedPrompt.effectiveProfile,
    effectiveProfileIds: preparedPrompt.effectiveProfileIds,
    delegableProfileIds: preparedPrompt.delegableProfileIds,
    toolAllowlist: preparedPrompt.allowedToolNames,
    projectRootPath: preparedPrompt.projectRootPath,
    projectId: context.projectId,
    sessionId: context.session?.sessionId ?? null,
    visibleTurnIds: preparedPrompt.visibleTurnIds,
    activeBranchId: preparedBranchId,
    signal: turn.preparationController.signal,
  });
  if (routePreflight.overlayDiagnostics?.length) {
    preparedTurn.summary.runtimeDiagnostics = routePreflight.overlayDiagnostics.map(formatAgentManifestDiagnostic);
    recordOverlayProfileDiagnostics(context, conversationAgentId, routePreflight.overlayDiagnostics, true);
  }
  throwIfPreparationCancelled(turn);
  const requestState = turn.requests.getPreparingRequestByRequestId(turn.requestId);
  if (requestState) requestState.phase = 'committing';
  return { preparedPrompt, preparedTurn };
}

/** The turn's commit while it is open: the staged or existing session commit and what it imported. */
interface TurnCommit {
  workingSession: SessionRecord | null;
  stagedSessionCommit: ReturnType<typeof sessionRecordStore.beginStagedConversationSession> | null;
  existingTurnCommit: ReturnType<typeof conversationHistoryStore.beginExistingConversationTurnCommit> | null;
  importedAttachments: SessionAttachmentRecord[];
  persistedHistoryBeforeCommit: ConversationMessage[];
  persistedBranchBeforeCommit: ConversationBranchState | null;
}

/** The messages the commit writes and the branch state they land on. */
interface TurnMessages {
  branchState: ConversationBranchState | null;
  userMessage: ConversationMessage;
  assistantDraftMessage: ConversationMessage;
  continuationNotice: ConversationMessage | null;
}

/**
 * The turn's durable commit: the staged or existing session takes the user message, the continuation notice, the
 * assistant draft and the branch state, then a run that owns the turn's outputs. A failure rolls the commit back.
 */
async function commitTurn(turn: TurnStart, route: TurnRoute, input: TurnInput, runtime: PreparedTurnRuntime): Promise<CommittedTurn> {
  const commit: TurnCommit = {
    workingSession: turn.context.session,
    stagedSessionCommit: null,
    existingTurnCommit: null,
    importedAttachments: [],
    persistedHistoryBeforeCommit: [],
    persistedBranchBeforeCommit: null,
  };
  try {
    beginTurnCommit(turn, input, commit);
    let messages = composeTurnMessages(turn, route, runtime, commit);
    writeTurnHistory(commit, messages);
    const created = await createTurnRun(turn, runtime, commit, messages);
    messages = created.messages;
    return {
      workingSession: commit.workingSession,
      importedAttachments: commit.importedAttachments,
      branchState: messages.branchState,
      turnRunId: created.turnRunId,
      userMessage: messages.userMessage,
      assistantDraftMessage: messages.assistantDraftMessage,
      continuationNotice: messages.continuationNotice,
    };
  } catch (error) {
    try {
      if (commit.stagedSessionCommit) sessionRecordStore.rollbackStagedConversationSession(commit.stagedSessionCommit);
      if (commit.existingTurnCommit) conversationHistoryStore.rollbackExistingConversationTurn(commit.existingTurnCommit);
    } catch (rollbackError) {
      console.error(`[ConversationService] Failed to roll back turn ${turn.turnIds.turnId}:`, rollbackError);
    }
    await runtime.preparedTurn.runtime.mcpLease?.release({ discardIfIdle: true });
    throw new AppError('TURN_COMMIT_FAILED', redactTechnicalMessage(error), { cause: error });
  }
}

/** Opens a staged session commit for a new session, or a turn commit on the existing one. */
function beginTurnCommit(turn: TurnStart, input: TurnInput, commit: TurnCommit): void {
  const { context, requestId, rawMessage } = turn;
  const { turnId } = turn.turnIds;
  const attachmentPaths = input.pendingAttachmentDescriptors.map((entry) => entry.filePath);
  if (!commit.workingSession && context.projectId) {
    commit.stagedSessionCommit = sessionRecordStore.beginStagedConversationSession(
      context.projectId,
      rawMessage.slice(0, 80),
      attachmentPaths,
      requestId,
      turnId,
      input.reservedSession
        ? { reserved: input.reservedSession, plannedAttachments: input.plannedAttachmentRecords }
        : undefined,
    );
    commit.workingSession = commit.stagedSessionCommit.session;
    commit.importedAttachments = commit.stagedSessionCommit.attachments;
  } else if (commit.workingSession) {
    commit.existingTurnCommit = conversationHistoryStore.beginExistingConversationTurnCommit(
      commit.workingSession.sessionId,
      attachmentPaths,
      requestId,
      turnId,
      input.plannedAttachmentRecords,
    );
    commit.importedAttachments = commit.existingTurnCommit.attachments;
    commit.persistedHistoryBeforeCommit = commit.existingTurnCommit.beforeHistory;
    commit.persistedBranchBeforeCommit = commit.existingTurnCommit.beforeBranch;
  } else if (turn.pendingAttachments.length > 0) {
    throw new AppError('ATTACHMENT_SESSION_REQUIRED', 'select or create a project session before attaching files.');
  }
}

/** The user message, the assistant draft, a continuation-drop notice when the route changed, and the branch. */
function composeTurnMessages(turn: TurnStart, route: TurnRoute, runtime: PreparedTurnRuntime, commit: TurnCommit): TurnMessages {
  const { context, branchContext, requestId, turnIds, conversationAgentId, rawMessage } = turn;
  const { turnId } = turnIds;
  const { preparedTurn } = runtime;
  const { persistedHistoryBeforeCommit } = commit;
  const sessionIdForBranch = commit.workingSession?.sessionId ?? null;
  let branchState = branchContext?.branchState ?? (sessionIdForBranch
    ? commit.persistedBranchBeforeCommit
    : null);
  if (sessionIdForBranch && !branchState) branchState = createDefaultBranchState(sessionIdForBranch);
  const branchId = branchContext?.branchId
    ?? branchState?.activeLeafBranchId
    ?? ROOT_BRANCH_ID;
  const userMessage = createConversationMessage('user', rawMessage, {
    id: turnIds.userMessageId,
    requestId,
    requestFingerprint: turn.requestFingerprint,
    turnId,
    sessionId: sessionIdForBranch,
    projectId: context.projectId,
    runId: isActiveRun(context.currentRun) ? context.currentRun.runId : null,
    profileId: conversationAgentId,
    attachments: commit.importedAttachments,
    status: 'complete',
    branchId,
    forkId: branchContext?.forkId,
    variantIndex: branchContext?.variantIndex,
    preparedContext: preparedTurn.summary,
    planReference: context.planReference,
  });
  const assistantDraftMessage = createConversationMessage('assistant', '', {
    id: turnIds.assistantMessageId,
    requestId,
    turnId,
    sessionId: sessionIdForBranch,
    projectId: context.projectId,
    runId: isActiveRun(context.currentRun) ? context.currentRun.runId : null,
    profileId: conversationAgentId,
    agentId: conversationAgentId,
    status: 'streaming',
    workTrace: createDraftWorkTrace(),
    branchId,
    preparedContext: preparedTurn.summary,
  });
  const previousPrepared = !sessionIdForBranch
    ? undefined
    : turn.excludeTurnId
      ? persistedHistoryBeforeCommit.find((entry) => (
        entry.turnId === turn.excludeTurnId && entry.role === 'assistant' && entry.preparedContext
      ))?.preparedContext
      : [...persistedHistoryBeforeCommit].reverse().find((entry) => (
        entry.role === 'assistant' && entry.preparedContext && entry.status === 'complete'
      ))?.preparedContext;
  const continuationNotice = previousPrepared && shouldAnnounceContinuationDrop(previousPrepared, route.planning.plan)
    ? createContinuationDropNotice({
        requestId,
        turnId,
        sessionId: sessionIdForBranch,
        projectId: context.projectId,
        profileId: conversationAgentId,
        branchId,
        forkId: branchContext?.forkId,
        variantIndex: branchContext?.variantIndex,
        previous: previousPrepared.route,
        next: route.planning.plan,
      })
    : null;
  if (sessionIdForBranch && branchState && branchContext) {
    branchState = withRewriteVariant(branchState, branchContext, branchId, userMessage.id, turnId);
  }
  return { branchState, userMessage, assistantDraftMessage, continuationNotice };
}

/** Commits the session's history with the turn's messages (a staged session is renamed into place). */
function writeTurnHistory(commit: TurnCommit, messages: TurnMessages): void {
  if (!commit.workingSession?.sessionId) return;
  const committedHistory = [
    ...commit.persistedHistoryBeforeCommit,
    messages.userMessage,
    ...(messages.continuationNotice ? [messages.continuationNotice] : []),
    messages.assistantDraftMessage,
  ];
  if (commit.stagedSessionCommit) {
    commit.workingSession = sessionRecordStore.commitStagedConversationSession(
      commit.stagedSessionCommit,
      committedHistory,
      messages.branchState,
    );
  } else if (commit.existingTurnCommit) {
    conversationHistoryStore.commitExistingConversationTurn(commit.existingTurnCommit, committedHistory, messages.branchState);
  }
}

/**
 * Every persisted conversation turn receives a durable run before the agent starts. This is the sole owner for
 * explicit user Outputs; no renderer or action-payload fallback is allowed to invent an output.
 */
async function createTurnRun(
  turn: TurnStart,
  runtime: PreparedTurnRuntime,
  commit: TurnCommit,
  messages: TurnMessages,
): Promise<{ turnRunId: string | null; messages: TurnMessages }> {
  const { workingSession } = commit;
  if (!workingSession) return { turnRunId: null, messages };
  const { effectivePlan } = runtime.preparedTurn.runtime;
  const createdRun = await sessionRecordStore.createRun({
    caseId: workingSession.sessionId,
    sessionId: workingSession.sessionId,
    turnId: turn.turnIds.turnId,
    capturePaths: [],
    profileId: turn.conversationAgentId,
    completionContract: effectivePlan.completionContract,
    investigationMission: effectivePlan.investigationMission,
    goal: turn.rawMessage,
    status: 'running',
  });
  const turnRunId = createdRun.runId;
  const userMessage = { ...messages.userMessage, runId: turnRunId };
  const assistantDraftMessage = { ...messages.assistantDraftMessage, runId: turnRunId };
  const continuationNotice = messages.continuationNotice ? { ...messages.continuationNotice, runId: turnRunId } : null;
  conversationHistoryStore.appendConversationMessage(workingSession.sessionId, userMessage);
  if (continuationNotice) {
    conversationHistoryStore.appendConversationMessage(workingSession.sessionId, continuationNotice);
  }
  conversationHistoryStore.appendConversationMessage(workingSession.sessionId, assistantDraftMessage);
  return { turnRunId, messages: { ...messages, userMessage, assistantDraftMessage, continuationNotice } };
}

/** An edit-and-resend adds its variant to the fork and makes it the active leaf. */
function withRewriteVariant(
  branchState: ConversationBranchState,
  branchContext: ConversationBranchTurnContext,
  branchId: string,
  anchorUserMessageId: string,
  rootTurnId: string,
): ConversationBranchState {
  const nextBranchState = structuredClone(branchState);
  const fork = nextBranchState.forks.find((entry) => entry.forkId === branchContext.forkId);
  if (!fork || fork.branches.some((entry) => entry.branchId === branchId)) {
    throw new Error('Conversation branch state changed before the new variant was committed.');
  }
  fork.branches.push({
    branchId,
    parentBranchId: branchContext.parentBranchId,
    variantIndex: branchContext.variantIndex,
    anchorUserMessageId,
    rootTurnId,
  });
  fork.activeBranchId = branchId;
  nextBranchState.activeLeafBranchId = branchId;
  return nextBranchState;
}

/**
 * Publishes the committed turn and, unless Stop arrived during the commit, hands it to completeProfileTurn in the
 * background; the send result carries the committed messages, branch state and run.
 */
async function startCommittedTurn(
  turn: TurnStart,
  route: TurnRoute,
  runtime: PreparedTurnRuntime,
  committed: CommittedTurn,
): Promise<ConversationTurnResult> {
  const { requestId } = turn;
  const { preparedTurn } = runtime;
  const cancelAfterCommit = turn.requests.getPreparingRequestByRequestId(requestId)?.cancelAfterCommit === true;
  const projected = await projectCommittedTurn(turn, committed, cancelAfterCommit);
  const { workingSession } = projected;
  const committedTurnRun: RunSummary | null = workingSession && committed.turnRunId
    ? sessionRecordStore.listRuns(workingSession.sessionId).find(run => run.runId === committed.turnRunId) ?? null
    : null;
  if (cancelAfterCommit) {
    await preparedTurn.runtime.mcpLease?.release({ discardIfIdle: true });
  } else {
    runCommittedTurn(turn, route, runtime, committed, workingSession, committedTurnRun);
  }
  return {
    requestId,
    session: workingSession ? sessionRecordStore.readSessionSnapshot(workingSession.sessionId) : null,
    mode: 'talk',
    userMessage: committed.userMessage,
    assistantDraftMessage: committed.assistantDraftMessage,
    messages: projected.visibleMessages,
    branchState: committed.branchState ?? null,
    executionTransition: { action: 'none' },
    runUpdate: committedTurnRun,
    tracePresentation: projected.tracePresentation,
    errorViewModel: null,
    preparedContext: preparedTurn.summary,
  };
}

/** The session takes the turn's Agent; the visible messages and trace projection are published (stopped if cancelled). */
async function projectCommittedTurn(turn: TurnStart, committed: CommittedTurn, cancelAfterCommit: boolean): Promise<{
  workingSession: SessionRecord | null;
  visibleMessages: ConversationMessage[];
  tracePresentation: ConversationTurnResult['tracePresentation'];
}> {
  const { conversationAgentId, output } = turn;
  const { turnId } = turn.turnIds;
  const { branchState, userMessage, assistantDraftMessage, continuationNotice } = committed;
  let { workingSession } = committed;
  if (workingSession && conversationAgentId) {
    sessionRecordStore.updateSession(workingSession.sessionId, { agentId: conversationAgentId });
    workingSession = sessionRecordStore.readSession(workingSession.sessionId) ?? workingSession;
  }
  let visibleMessages = workingSession?.sessionId && branchState
    ? resolveVisibleConversationMessages(
        conversationHistoryStore.readConversationHistory(workingSession.sessionId),
        branchState,
      )
    : [userMessage, ...(continuationNotice ? [continuationNotice] : []), assistantDraftMessage];
  const traceSessionId = workingSession?.sessionId ?? output.ephemeralTraceSessionId(turnId);
  let tracePresentation = await traceService.buildConversationPresentation(
    traceSessionId,
    [userMessage, assistantDraftMessage],
  );
  if (cancelAfterCommit) {
    assistantDraftMessage.status = 'stopped';
    assistantDraftMessage.updatedAt = nowMs();
    assistantDraftMessage.workTrace = finalizeTrace(
      assistantDraftMessage.workTrace,
      'stopped',
      'Request stopped after commit.',
    );
    const persistError = output.persistConversationSnapshot(workingSession?.sessionId ?? null, assistantDraftMessage);
    if (persistError) console.error(`[ConversationService] Failed to persist cancelled turn ${turnId}:`, persistError);
    visibleMessages = workingSession?.sessionId && branchState
      ? resolveVisibleConversationMessages(
          conversationHistoryStore.readConversationHistory(workingSession.sessionId),
          branchState,
        )
      : [userMessage, assistantDraftMessage];
    tracePresentation = await traceService.buildConversationPresentation(
      traceSessionId,
      [userMessage, assistantDraftMessage],
    );
  }
  // The turn-start projection is published by output.publishConversationTrace below: for a
  // persisted session it resolves the full traceService.getSession projection (including the
  // buildRightPanel progress/artifacts/context payload). Publishing the lightweight
  // conversation-only presentation here first would overwrite the previous turn's full
  // projection and blank the right-rail sections until the full projection arrives.
  output.publishConversationTrace(traceSessionId, [userMessage, assistantDraftMessage], workingSession?.sessionId ?? null);
  return { workingSession, visibleMessages, tracePresentation };
}

/** The credential lease passes to the running turn, which completes in the background. */
function runCommittedTurn(
  turn: TurnStart,
  route: TurnRoute,
  runtime: PreparedTurnRuntime,
  committed: CommittedTurn,
  workingSession: SessionRecord | null,
  committedTurnRun: RunSummary | null,
): void {
  const { context, requestId, conversationAgentId } = turn;
  const { turnId } = turn.turnIds;
  const { preparedTurn } = runtime;
  const runningRequestState = turn.requests.getPreparingRequestByRequestId(requestId);
  if (runningRequestState) runningRequestState.credentialLeaseTransferred = true;
  void completeProfileTurn({ output: turn.output, turns: turn.turns }, {
    context: {
      ...context,
      session: workingSession,
      currentRun: committedTurnRun ?? context.currentRun,
    },
    requestedProfileId: turn.requestedProfileId ?? conversationAgentId,
    requestedAgentId: conversationAgentId,
    rawMessage: turn.rawMessage,
    importedAttachments: committed.importedAttachments,
    userMessage: committed.userMessage,
    assistantDraftMessage: committed.assistantDraftMessage,
    requestId,
    routePreflight: route.routePreflight,
    planning: route.planning,
    preparedPrompt: runtime.preparedPrompt,
    preparedTurn,
    policyBudget: turn.policyBudget,
  }).catch((error) => {
    agentOrchestrator.releaseProviderRuntimeCredentials(preparedTurn.runtime.credentialHandle);
    console.error(`[ConversationService] Background turn ${turnId} failed before terminal cleanup:`, error);
  });
}
