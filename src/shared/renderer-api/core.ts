import type {
  AgentApi,
  AppMetaApi,
  AppShellApi,
  CommandApi,
  ConversationApi,
  DialogApi,
  EvidenceApi,
  InvestigationApi,
  KnowledgeApi,
  PlanApi,
  McpApi,
  ToolApi,
  WindowControlsApi,
  WorkflowApi,
} from '../types/electron-api';
import type { ElectronAPI } from '../types/electron';
import { RENDERER_EVENT_CHANNEL as EVENT, RENDERER_INVOKE_CHANNEL as INVOKE } from './channels';
import type { RendererApiTransport, RendererEventCallback } from './transport';

export function createAppMetaApi(transport: RendererApiTransport): AppMetaApi {
  return { get: () => transport.invoke(INVOKE.shell.getAppMeta) };
}

export function createAppShellApi(transport: RendererApiTransport): AppShellApi {
  return {
    hasSeenGettingStarted: () => transport.invoke(INVOKE.shell.hasSeenGettingStarted),
    acknowledgeGettingStarted: () => transport.invoke(INVOKE.shell.acknowledgeGettingStarted),
    selectAvatar: () => transport.invoke(INVOKE.shell.selectAvatar),
    getAvatarDataUrl: (avatarPath) => transport.invoke(INVOKE.shell.getAvatarDataUrl, avatarPath),
    openPath: (targetPath) => transport.invoke(INVOKE.shell.openPath, targetPath),
    copyText: (text) => transport.invoke(INVOKE.shell.copyText, text),
    readClipboardText: () => transport.invoke(INVOKE.shell.readClipboardText),
  };
}

export function createWebApi(transport: RendererApiTransport): ElectronAPI['web'] {
  return { resolveFavicon: (domain) => transport.invoke(INVOKE.shell.resolveFavicon, domain) };
}

export function createDialogApi(transport: RendererApiTransport): DialogApi {
  return {
    selectFiles: () => transport.invoke(INVOKE.shell.selectFiles),
    selectRdcFiles: () => transport.invoke(INVOKE.shell.selectRdcFiles),
    selectKnowledgeImport: () => transport.invoke(INVOKE.shell.selectKnowledgeImport),
    selectDirectory: () => transport.invoke(INVOKE.shell.selectDirectory),
    saveFile: (request) => transport.invoke(INVOKE.shell.saveFile, request),
  };
}

export function createWindowControlsApi(transport: RendererApiTransport): WindowControlsApi {
  return {
    minimize: () => transport.invoke(INVOKE.shell.minimizeWindow),
    toggleMaximize: () => transport.invoke(INVOKE.shell.toggleMaximizeWindow),
    close: () => transport.invoke(INVOKE.shell.closeWindow),
    isMaximized: () => transport.invoke(INVOKE.shell.isWindowMaximized),
  };
}

export function createConversationApi(transport: RendererApiTransport): ConversationApi {
  return {
    sendMessage: (request) => transport.invoke(INVOKE.conversation.sendMessage, request),
    rewriteFromMessage: (request) => transport.invoke(INVOKE.conversation.rewriteFromMessage, request),
    cancelActiveTurn: (request) => transport.invoke(INVOKE.conversation.cancelActiveTurn, request),
    answerUserInput: (request) => transport.invoke(INVOKE.conversation.answerUserInput, request),
    answerToolApproval: (request) => transport.invoke(INVOKE.conversation.answerToolApproval, request),
    answerPlanReview: (request) => transport.invoke(INVOKE.conversation.answerPlanReview, request),
    getHistory: (sessionId) => transport.invoke(INVOKE.conversation.getHistory, sessionId),
    getDelegationTrace: (request) => transport.invoke(INVOKE.conversation.getDelegationTrace, request),
    getDelegationContent: (request) => transport.invoke(INVOKE.conversation.getDelegationContent, request),
    switchBranch: (request) => transport.invoke(INVOKE.conversation.switchBranch, request),
    clearHistory: (sessionId) => transport.invoke(INVOKE.conversation.clearHistory, sessionId),
    undoLastTurn: (sessionId) => transport.invoke(INVOKE.conversation.undoLastTurn, sessionId),
    getToolImagePreview: (request) => transport.invoke(INVOKE.conversation.getToolImagePreview, request),
    stageAttachments: (request) => transport.invoke(INVOKE.conversation.stageAttachments, request),
    releaseAttachments: (request) => transport.invoke(INVOKE.conversation.releaseAttachments, request),
    getAttachmentPreview: (request) => transport.invoke(INVOKE.conversation.getAttachmentPreview, request),
    onEvent: (callback): void => {
      transport.addListener(EVENT.conversation.event, callback as unknown as RendererEventCallback);
    },
    offEvent: (callback): void => {
      transport.removeListener(EVENT.conversation.event, callback as unknown as RendererEventCallback);
    },
  };
}

export function createWorkflowApi(transport: RendererApiTransport): WorkflowApi {
  return {
    getState: () => transport.invoke(INVOKE.workflow.getState),
    resume: (sessionId) => transport.invoke(INVOKE.workflow.resume, sessionId),
    stop: (runId) => transport.invoke(INVOKE.workflow.stop, runId),
    getRunUsage: (request) => transport.invoke(INVOKE.workflow.getRunUsage, request),
    listRuns: () => transport.invoke(INVOKE.workflow.listRuns),
    listActiveRuns: () => transport.invoke(INVOKE.workflow.listActiveRuns),
  };
}

export function createAgentApi(transport: RendererApiTransport): AgentApi {
  return {
    sendMessage: (agentId, content) => transport.invoke(INVOKE.agent.sendMessage, agentId, content),
    getState: (agentId, sessionId) => transport.invoke(INVOKE.agent.getState, agentId, sessionId),
    getAllStates: () => transport.invoke(INVOKE.agent.getAllStates),
    configure: (agentId, config) => transport.invoke(INVOKE.agent.configure, agentId, config),
  };
}

export function createInvestigationApi(transport: RendererApiTransport): InvestigationApi {
  return {
    read: (request) => transport.invoke(INVOKE.investigation.read, request),
  };
}

export function createPlanApi(transport: RendererApiTransport): PlanApi {
  return {
    read: (request) => transport.invoke(INVOKE.plan.read, request),
    issueApprovalToken: (request) => transport.invoke(INVOKE.plan.issueApprovalToken, request),
    saveToProject: (request) => transport.invoke(INVOKE.plan.saveToProject, request),
    export: (request) => transport.invoke(INVOKE.plan.export, request),
  };
}

export function createKnowledgeApi(transport: RendererApiTransport): KnowledgeApi {
  return {
    overview: () => transport.invoke(INVOKE.knowledge.overview),
    query: (request) => transport.invoke(INVOKE.knowledge.query, request),
    card: (spaceId, relativePath) => transport.invoke(INVOKE.knowledge.card, spaceId, relativePath),
    compile: (request) => transport.invoke(INVOKE.knowledge.compile, request),
    indexRebuild: () => transport.invoke(INVOKE.knowledge.indexRebuild),
    candidates: (sessionId) => transport.invoke(INVOKE.knowledge.candidates, sessionId),
    candidateCreate: (request) => transport.invoke(INVOKE.knowledge.candidateCreate, request),
    import: (request) => transport.invoke(INVOKE.knowledge.import, request),
    image: (request) => transport.invoke(INVOKE.knowledge.image, request),
    issueApprovalToken: (request) => transport.invoke(INVOKE.knowledge.issueApprovalToken, request),
    write: (request) => transport.invoke(INVOKE.knowledge.write, request),
    promote: (request) => transport.invoke(INVOKE.knowledge.promote, request),
    export: (request) => transport.invoke(INVOKE.knowledge.export, request),
  };
}

export function createCommandApi(transport: RendererApiTransport): CommandApi {
  return {
    list: (category) => transport.invoke(INVOKE.command.list, category),
    execute: (request) => transport.invoke(INVOKE.command.execute, request),
  };
}

export function createToolApi(transport: RendererApiTransport): ToolApi {
  return {
    getCatalog: () => transport.invoke(INVOKE.tools.getCatalog),
    getRuntimeSummary: () => transport.invoke(INVOKE.tools.getRuntimeSummary),
    detectInstallations: () => transport.invoke(INVOKE.tools.detectInstallations),
    resolveInstallation: (request) => transport.invoke(INVOKE.tools.resolveInstallation, request),
    verifyInstallation: (request) => transport.invoke(INVOKE.tools.verifyInstallation, request),
  };
}

export function createMcpApi(transport: RendererApiTransport): McpApi {
  return { getStatusSummary: () => transport.invoke(INVOKE.tools.getMcpStatusSummary) };
}

export function createEvidenceApi(transport: RendererApiTransport): EvidenceApi {
  return {
    getChain: () => transport.invoke(INVOKE.tools.getEvidenceChain),
    getEvents: (eventType) => transport.invoke(INVOKE.tools.getEvidenceEvents, eventType),
  };
}
