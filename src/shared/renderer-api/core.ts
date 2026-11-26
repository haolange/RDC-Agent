import type {
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
import type { RendererEvents } from './rendererEvents';
import type { RendererApiTransport } from './transport';

export function createAppMetaApi(transport: RendererApiTransport): AppMetaApi {
  return { get: () => transport.invoke('app:getMeta') };
}

export function createAppShellApi(transport: RendererApiTransport): AppShellApi {
  return {
    selectAvatar: () => transport.invoke('app:selectAvatar'),
    getAvatarDataUrl: (avatarPath) => transport.invoke('app:getAvatarDataUrl', avatarPath),
    openPath: (targetPath) => transport.invoke('app:openPath', targetPath),
    copyText: (text) => transport.invoke('app:copyText', text),
    readClipboardText: () => transport.invoke('app:readClipboardText'),
    getCrashFiles: () => transport.invoke('app:getCrashFiles'),
    clearCrashFiles: () => transport.invoke('app:clearCrashFiles'),
  };
}

export function createWebApi(transport: RendererApiTransport): ElectronAPI['web'] {
  return {
    resolveFavicon: (domain) => transport.invoke('web:resolveFavicon', domain),
    fetchImage: (request) => transport.invoke('web:fetchImage', request),
  };
}

export function createDialogApi(transport: RendererApiTransport): DialogApi {
  return {
    selectFiles: () => transport.invoke('dialog:selectFiles'),
    selectRdcFiles: () => transport.invoke('dialog:selectRdcFiles'),
    selectKnowledgeImport: () => transport.invoke('dialog:selectKnowledgeImport'),
    selectDirectory: () => transport.invoke('dialog:selectDirectory'),
  };
}

export function createWindowControlsApi(transport: RendererApiTransport): WindowControlsApi {
  return {
    minimize: () => transport.invoke('window:minimize'),
    toggleMaximize: () => transport.invoke('window:toggleMaximize'),
    close: () => transport.invoke('window:close'),
    isMaximized: () => transport.invoke('window:isMaximized'),
  };
}

export function createConversationApi(transport: RendererApiTransport, events: RendererEvents): ConversationApi {
  return {
    sendMessage: (request) => transport.invoke('conversation:sendMessage', request),
    rewriteFromMessage: (request) => transport.invoke('conversation:rewriteFromMessage', request),
    cancelActiveTurn: (request) => transport.invoke('conversation:cancelActiveTurn', request),
    answerUserInput: (request) => transport.invoke('conversation:answerUserInput', request),
    answerToolApproval: (request) => transport.invoke('conversation:answerToolApproval', request),
    answerPlanReview: (request) => transport.invoke('conversation:answerPlanReview', request),
    getHistory: (sessionId) => transport.invoke('conversation:getHistory', sessionId),
    getMessageSnapshot: (sessionId, messageId) =>
      transport.invoke('conversation:getMessageSnapshot', sessionId, messageId),
    getDelegationTrace: (request) => transport.invoke('conversation:getDelegationTrace', request),
    getDelegationContent: (request) => transport.invoke('conversation:getDelegationContent', request),
    switchBranch: (request) => transport.invoke('conversation:switchBranch', request),
    clearHistory: (sessionId) => transport.invoke('conversation:clearHistory', sessionId),
    undoLastTurn: (sessionId) => transport.invoke('conversation:undoLastTurn', sessionId),
    getToolImagePreview: (request) => transport.invoke('conversation:getToolImagePreview', request),
    stageAttachments: (request) => transport.invoke('conversation:stageAttachments', request),
    releaseAttachments: (request) => transport.invoke('conversation:releaseAttachments', request),
    getAttachmentPreview: (request) => transport.invoke('conversation:getAttachmentPreview', request),
    accessAttachment: (request) => transport.invoke('conversation:accessAttachment', request),
    resolveMedia: (request) => transport.invoke('conversation:resolveMedia', request),
    onEvent: (callback) => events.add('conversation:event', callback),
    offEvent: (callback) => events.remove('conversation:event', callback),
  };
}

export function createWorkflowApi(transport: RendererApiTransport): WorkflowApi {
  return {
    getState: () => transport.invoke('workflow:getState'),
    resume: (sessionId) => transport.invoke('workflow:resume', sessionId),
    stop: (runId) => transport.invoke('workflow:stop', runId),
    getRunUsage: (request) => transport.invoke('workflow:getRunUsage', request),
  };
}

export function createInvestigationApi(transport: RendererApiTransport): InvestigationApi {
  return {
    read: (request) => transport.invoke('investigation:read', request),
    list: (request) => transport.invoke('investigation:list', request),
  };
}

export function createPlanApi(transport: RendererApiTransport): PlanApi {
  return {
    reopenReview: (request) => transport.invoke('plan:reopenReview', request),
    cancelReview: (request) => transport.invoke('plan:cancelReview', request),
    read: (request) => transport.invoke('plan:read', request),
    issueApprovalToken: (request) => transport.invoke('plan:issueApprovalToken', request),
    saveToProject: (request) => transport.invoke('plan:saveToProject', request),
    export: (request) => transport.invoke('plan:export', request),
  };
}

export function createKnowledgeApi(transport: RendererApiTransport): KnowledgeApi {
  return {
    overview: () => transport.invoke('knowledge:overview'),
    topicSuggest: () => transport.invoke('knowledge:topics:suggest'),
    topicPreview: (changes) => transport.invoke('knowledge:topics:preview', changes),
    topicApply: (request) => transport.invoke('knowledge:topics:apply', request),
    query: (request) => transport.invoke('knowledge:query', request),
    card: (spaceId, relativePath) => transport.invoke('knowledge:card', spaceId, relativePath),
    compile: (request) => transport.invoke('knowledge:compile', request),
    indexRebuild: (request) => transport.invoke('knowledge:index:rebuild', request),
    candidates: (sessionId) => transport.invoke('knowledge:candidates', sessionId),
    candidateCreate: (request) => transport.invoke('knowledge:candidateCreate', request),
    previewImport: (request) => transport.invoke('knowledge:previewImport', request),
    import: (request) => transport.invoke('knowledge:import', request),
    image: (request) => transport.invoke('knowledge:image', request),
    issueApprovalToken: (request) => transport.invoke('knowledge:issueApprovalToken', request),
    write: (request) => transport.invoke('knowledge:write', request),
    promote: (request) => transport.invoke('knowledge:promote', request),
    export: (request) => transport.invoke('knowledge:export', request),
    cancel: (request) => transport.invoke('knowledge:cancel', request),
  };
}

export function createCommandApi(transport: RendererApiTransport): CommandApi {
  return {
    list: (category) =>
      category === undefined ? transport.invoke('command:list') : transport.invoke('command:list', category),
    execute: (request) => transport.invoke('command:execute', request),
  };
}

export function createToolApi(transport: RendererApiTransport): ToolApi {
  return {
    detectInstallations: () => transport.invoke('tool:detectInstallations'),
    resolveInstallation: (request) => transport.invoke('tool:resolveInstallation', request),
    verifyInstallation: (request) => transport.invoke('tool:verifyInstallation', request),
  };
}

export function createMcpApi(transport: RendererApiTransport): McpApi {
  return { getStatusSummary: () => transport.invoke('mcp:getStatusSummary') };
}

export function createEvidenceApi(transport: RendererApiTransport): EvidenceApi {
  return {
    getChain: () => transport.invoke('evidence:getChain'),
  };
}
