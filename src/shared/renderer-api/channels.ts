export const RENDERER_INVOKE_CHANNEL = {
  shell: {
    getAppMeta: 'app:getMeta',
    selectAvatar: 'app:selectAvatar',
    getAvatarDataUrl: 'app:getAvatarDataUrl',
    openPath: 'app:openPath',
    copyText: 'app:copyText',
    readClipboardText: 'app:readClipboardText',
    resolveFavicon: 'web:resolveFavicon',
    selectFiles: 'dialog:selectFiles',
    selectRdcFiles: 'dialog:selectRdcFiles',
    selectDirectory: 'dialog:selectDirectory',
    saveFile: 'dialog:saveFile',
    minimizeWindow: 'window:minimize',
    toggleMaximizeWindow: 'window:toggleMaximize',
    closeWindow: 'window:close',
    isWindowMaximized: 'window:isMaximized',
  },
  conversation: {
    sendMessage: 'conversation:sendMessage',
    rewriteFromMessage: 'conversation:rewriteFromMessage',
    cancelActiveTurn: 'conversation:cancelActiveTurn',
    answerUserInput: 'conversation:answerUserInput',
    answerToolApproval: 'conversation:answerToolApproval',
    answerPlanReview: 'conversation:answerPlanReview',
    getHistory: 'conversation:getHistory',
    switchBranch: 'conversation:switchBranch',
    clearHistory: 'conversation:clearHistory',
    undoLastTurn: 'conversation:undoLastTurn',
    getToolImagePreview: 'conversation:getToolImagePreview',
    stageAttachments: 'conversation:stageAttachments',
    releaseAttachments: 'conversation:releaseAttachments',
    getAttachmentPreview: 'conversation:getAttachmentPreview',
  },
  workflow: {
    getState: 'workflow:getState',
    resume: 'workflow:resume',
    stop: 'workflow:stop',
    getRunUsage: 'workflow:getRunUsage',
    listRuns: 'workflow:listRuns',
    listActiveRuns: 'workflow:listActiveRuns',
  },
  agent: {
    sendMessage: 'agent:sendMessage',
    getState: 'agent:getState',
    getAllStates: 'agent:getAllStates',
    configure: 'agent:configure',
  },
  memory: {
    issueApprovalToken: 'memory:issueApprovalToken',
    list: 'memory:list',
    get: 'memory:get',
    write: 'memory:write',
    delete: 'memory:delete',
  },
  investigation: {
    read: 'investigation:read',
  },
  plan: {
    read: 'plan:read',
    issueApprovalToken: 'plan:issueApprovalToken',
    saveToProject: 'plan:saveToProject',
    export: 'plan:export',
  },
  knowledge: {
    overview: 'knowledge:overview',
    query: 'knowledge:query',
    card: 'knowledge:card',
    compile: 'knowledge:compile',
    indexRebuild: 'knowledge:index:rebuild',
    candidates: 'knowledge:candidates',
    candidateCreate: 'knowledge:candidateCreate',
    coldDataImport: 'knowledge:coldDataImport',
    issueApprovalToken: 'knowledge:issueApprovalToken',
    write: 'knowledge:write',
    promote: 'knowledge:promote',
    export: 'knowledge:export',
  },
  rdxRuntime: {
    getOverview: 'rdx-runtime:overview',
    validateResource: 'rdx-runtime:validate',
    upsertResource: 'rdx-runtime:upsert',
    importResource: 'rdx-runtime:import',
    deleteResource: 'rdx-runtime:delete',
    revealResource: 'rdx-runtime:reveal',
    trustHook: 'rdx-runtime:trustHook',
    revokeHook: 'rdx-runtime:revokeHook',
    trustMcp: 'rdx-runtime:trustMcp',
    revokeMcp: 'rdx-runtime:revokeMcp',
    testHook: 'rdx-runtime:testHook',
    listRequestSnapshots: 'rdx-runtime:listSnapshots',
    getRequestSnapshot: 'rdx-runtime:getSnapshot',
  },
  command: {
    list: 'command:list',
    execute: 'command:execute',
  },
  tools: {
    getCatalog: 'tool:getCatalog',
    getRuntimeSummary: 'tool:getRuntimeSummary',
    getMcpStatusSummary: 'mcp:getStatusSummary',
    getEvidenceChain: 'evidence:getChain',
    getEvidenceEvents: 'evidence:getEvents',
  },
  llm: {
    testProviderDraft: 'llm:testProviderDraft',
    testModelCapability: 'llm:testModelCapability',
    connectProvider: 'llm:connectProvider',
    refreshProviderModels: 'llm:refreshProviderModels',
    disconnectProvider: 'llm:disconnectProvider',
    startProviderAccountLogin: 'llm:startProviderAccountLogin',
    getProviderAccountStatus: 'llm:getProviderAccountStatus',
    finishProviderAccountLogin: 'llm:finishProviderAccountLogin',
    logoutProviderAccount: 'llm:logoutProviderAccount',
  },
  settings: {
    get: 'settings:get',
    getProviderCatalog: 'settings:getProviderCatalog',
    getEffectiveModel: 'settings:getEffectiveModel',
    getEffectiveCatalog: 'settings:getEffectiveCatalog',
    hasProviderSecret: 'settings:hasProviderSecret',
    importAgentManifest: 'settings:importAgentManifest',
    saveAgentDefinition: 'settings:saveAgentDefinition',
    getAgentDefinitionCommit: 'settings:getAgentDefinitionCommit',
    saveProviderDefinition: 'settings:saveProviderDefinition',
    getProviderDefinitionCommit: 'settings:getProviderDefinitionCommit',
    getModelsOverride: 'settings:getModelsOverride',
    setModelsOverride: 'settings:setModelsOverride',
    getResolvedShell: 'settings:getResolvedShell',
    set: 'settings:set',
  },
  project: {
    list: 'project:list',
    add: 'project:add',
    select: 'project:select',
    rename: 'project:rename',
    remove: 'project:remove',
    listInputs: 'project:inputs:list',
    refreshInputs: 'project:inputs:refresh',
    importInput: 'project:inputs:import',
    importInputPaths: 'project:inputs:importPaths',
    prepareRemoveInput: 'project:inputs:prepareRemove',
    removeInput: 'project:inputs:remove',
  },
  device: {
    list: 'device:list',
    refresh: 'device:refresh',
    watchStart: 'device:watch:start',
    watchRenew: 'device:watch:renew',
    watchStop: 'device:watch:stop',
  },
  session: {
    list: 'session:list',
    create: 'session:create',
    rename: 'session:rename',
    remove: 'session:remove',
    select: 'session:select',
    setModelOverride: 'session:setModelOverride',
    setAgentId: 'session:setAgentId',
    applyDeclaredHandoff: 'session:applyDeclaredHandoff',
  },
  run: {
    list: 'run:list',
  },
  runtime: {
    listLogs: 'runtimeLog:list',
  },
  capture: {
    list: 'capture:list',
    select: 'capture:select',
    openProjectInput: 'capture:openProjectInput',
    getOpenedState: 'capture:getOpenedState',
    clearOpenedState: 'capture:clearOpenedState',
    getReplaySelection: 'capture:getReplaySelection',
    listReplayHistory: 'capture:listReplayHistory',
    readReplayImage: 'capture:readReplayImage',
    readLivePreview: 'capture:readLivePreview',
    clearReplayHistory: 'capture:clearReplayHistory',
    getReplayState: 'capture:getReplayState',
    applyReplayEvent: 'capture:applyReplayEvent',
    refreshFrame: 'capture:refreshFrame',
  },
  context: {
    get: 'context:get',
  },
  trace: {
    getRun: 'trace:getRun',
    getEvents: 'trace:getEvents',
    getProjection: 'trace:getProjection',
    exportRun: 'trace:exportRun',
    switchBranch: 'trace:switchBranch',
  },
} as const;

export const RENDERER_EVENT_CHANNEL = {
  shell: {
    fileOpen: 'file:open',
    caseNew: 'case:new',
    settingsOpen: 'settings:open',
    themeChanged: 'app:themeChanged',
    windowMaximizedChanged: 'window:maximized-changed',
  },
  conversation: {
    event: 'conversation:event',
  },
  workflow: {
    runStatusChanged: 'workflow:runStatusChanged',
    runUsageChanged: 'workflow:runUsageChanged',
    blocked: 'workflow:blocked',
    traceProjectionChanged: 'trace:projectionChanged',
  },
  llm: {
    stream: 'llm:stream',
    effectiveCatalogChanged: 'llm:effectiveCatalogChanged',
  },
  agent: {
    message: 'agent:message',
    statusChanged: 'agent:statusChanged',
  },
  tools: {
    executionComplete: 'tool:executionComplete',
    evidenceAdded: 'evidence:eventAdded',
  },
  workbench: {
    deviceStatusChanged: 'device:statusChanged',
    captureStatusChanged: 'capture:statusChanged',
    contextChanged: 'context:changed',
    projectInputsChanged: 'project:inputsChanged',
    projectInputsError: 'project:inputsError',
    openedCaptureStateChanged: 'capture:openedStateChanged',
    captureReplayChanged: 'capture:replayChanged',
  },
  runtime: {
    logAppended: 'runtime:logAppended',
  },
} as const;

type Values<T> = T[keyof T];
type NestedValues<T> = Values<{ [K in keyof T]: Values<T[K]> }>;

export type RendererInvokeChannel = NestedValues<typeof RENDERER_INVOKE_CHANNEL>;
export type RendererEventChannel = NestedValues<typeof RENDERER_EVENT_CHANNEL>;

export const RENDERER_INVOKE_CHANNELS = Object.freeze(
  Object.values(RENDERER_INVOKE_CHANNEL).flatMap((domain) => Object.values(domain)),
) as readonly RendererInvokeChannel[];

export const RENDERER_EVENT_CHANNELS = Object.freeze(
  Object.values(RENDERER_EVENT_CHANNEL).flatMap((domain) => Object.values(domain)),
) as readonly RendererEventChannel[];

const rendererInvokeChannelSet = new Set<string>(RENDERER_INVOKE_CHANNELS);
const rendererEventChannelSet = new Set<string>(RENDERER_EVENT_CHANNELS);

export function isRendererInvokeChannel(channel: string): channel is RendererInvokeChannel {
  return rendererInvokeChannelSet.has(channel);
}

export function isRendererEventChannel(channel: string): channel is RendererEventChannel {
  return rendererEventChannelSet.has(channel);
}
