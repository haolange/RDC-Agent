import type {
  AgentApi,
  AppMetaApi,
  AppShellApi,
  CommandApi,
  ConversationApi,
  DialogApi,
  EvidenceApi,
  KnowledgeApi,
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
    selectAvatar: () => transport.invoke(INVOKE.shell.selectAvatar),
    getAvatarDataUrl: (avatarPath) => transport.invoke(INVOKE.shell.getAvatarDataUrl, avatarPath),
    openPath: (targetPath) => transport.invoke(INVOKE.shell.openPath, targetPath),
    copyText: (text) => transport.invoke(INVOKE.shell.copyText, text),
  };
}

export function createWebApi(transport: RendererApiTransport): ElectronAPI['web'] {
  return { resolveFavicon: (domain) => transport.invoke(INVOKE.shell.resolveFavicon, domain) };
}

export function createDialogApi(transport: RendererApiTransport): DialogApi {
  return {
    selectFiles: () => transport.invoke(INVOKE.shell.selectFiles),
    selectRdcFiles: () => transport.invoke(INVOKE.shell.selectRdcFiles),
    selectDirectory: () => transport.invoke(INVOKE.shell.selectDirectory),
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
    getHistory: (sessionId) => transport.invoke(INVOKE.conversation.getHistory, sessionId),
    switchBranch: (request) => transport.invoke(INVOKE.conversation.switchBranch, request),
    clearHistory: (sessionId) => transport.invoke(INVOKE.conversation.clearHistory, sessionId),
    undoLastTurn: (sessionId) => transport.invoke(INVOKE.conversation.undoLastTurn, sessionId),
    compactHistory: (sessionId) => transport.invoke(INVOKE.conversation.compactHistory, sessionId),
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

export function createKnowledgeApi(transport: RendererApiTransport): KnowledgeApi {
  return {
    listSpaces: () => transport.invoke(INVOKE.knowledge.listSpaces),
    listCards: (spaceId) => transport.invoke(INVOKE.knowledge.listCards, spaceId),
    getCard: (spaceId, relativePath) => transport.invoke(INVOKE.knowledge.getCard, spaceId, relativePath),
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
