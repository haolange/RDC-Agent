export const RENDERER_INVOKE_CHANNEL = {
  shell: {
    getAppMeta: 'app:getMeta',
    hasSeenGettingStarted: 'app:hasSeenGettingStarted',
    acknowledgeGettingStarted: 'app:acknowledgeGettingStarted',
    selectAvatar: 'app:selectAvatar',
    getAvatarDataUrl: 'app:getAvatarDataUrl',
    openPath: 'app:openPath',
    copyText: 'app:copyText',
    readClipboardText: 'app:readClipboardText',
    resolveFavicon: 'web:resolveFavicon',
    selectFiles: 'dialog:selectFiles',
    selectRdcFiles: 'dialog:selectRdcFiles',
    selectKnowledgeImport: 'dialog:selectKnowledgeImport',
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
    getDelegationTrace: 'conversation:getDelegationTrace',
    getDelegationContent: 'conversation:getDelegationContent',
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
    list: 'investigation:list',
  },
  plan: {
    reopenReview: 'plan:reopenReview',
    cancelReview: 'plan:cancelReview',
    read: 'plan:read',
    issueApprovalToken: 'plan:issueApprovalToken',
    saveToProject: 'plan:saveToProject',
    export: 'plan:export',
  },
  knowledge: {
    overview: 'knowledge:overview',
    topicSuggest: 'knowledge:topics:suggest',
    topicPreview: 'knowledge:topics:preview',
    topicApply: 'knowledge:topics:apply',
    query: 'knowledge:query',
    card: 'knowledge:card',
    read: 'knowledge:read',
    compile: 'knowledge:compile',
    indexRebuild: 'knowledge:index:rebuild',
    candidates: 'knowledge:candidates',
    candidateCreate: 'knowledge:candidateCreate',
    import: 'knowledge:import',
    image: 'knowledge:image',
    issueApprovalToken: 'knowledge:issueApprovalToken',
    write: 'knowledge:write',
    promote: 'knowledge:promote',
    export: 'knowledge:export',
  },
  rdcRuntime: {
    getOverview: 'rdc-runtime:overview',
    validateResource: 'rdc-runtime:validate',
    upsertResource: 'rdc-runtime:upsert',
    importResource: 'rdc-runtime:import',
    deleteResource: 'rdc-runtime:delete',
    revealResource: 'rdc-runtime:reveal',
    trustHook: 'rdc-runtime:trustHook',
    revokeHook: 'rdc-runtime:revokeHook',
    trustMcp: 'rdc-runtime:trustMcp',
    revokeMcp: 'rdc-runtime:revokeMcp',
    testHook: 'rdc-runtime:testHook',
    listRequestSnapshots: 'rdc-runtime:listSnapshots',
    getRequestSnapshot: 'rdc-runtime:getSnapshot',
  },
  command: {
    list: 'command:list',
    execute: 'command:execute',
  },
  tools: {
    detectInstallations: 'tool:detectInstallations',
    resolveInstallation: 'tool:resolveInstallation',
    verifyInstallation: 'tool:verifyInstallation',
    getMcpStatusSummary: 'mcp:getStatusSummary',
    getEvidenceChain: 'evidence:getChain',
  },
  llm: {
    testProviderDraft: 'llm:testProviderDraft',
    testModelCapability: 'llm:testModelCapability',
    prepareProbeBatch: 'llm:prepareProbeBatch',
    startProbeBatch: 'llm:startProbeBatch',
    cancelProbeBatch: 'llm:cancelProbeBatch',
    getProbeBatch: 'llm:getProbeBatch',
    connectProvider: 'llm:connectProvider',
    refreshProviderModels: 'llm:refreshProviderModels',
    disconnectProvider: 'llm:disconnectProvider',
    startProviderAccountLogin: 'llm:startProviderAccountLogin',
    getProviderAccountStatus: 'llm:getProviderAccountStatus',
    finishProviderAccountLogin: 'llm:finishProviderAccountLogin',
    cancelProviderAccountLogin: 'llm:cancelProviderAccountLogin',
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
    referenceInput: 'project:inputs:reference',
    prepareRemoveInput: 'project:inputs:prepareRemove',
    removeInput: 'project:inputs:remove',
  },
  device: {
    prepare: 'device:prepare',
    cancelPreparation: 'device:cancelPreparation',
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
    getPermissionState: 'runtime:getPermissionState',
  },
  capture: {
    list: 'capture:list',
    select: 'capture:select',
    openProjectInput: 'capture:openProjectInput',
    getOpenedState: 'capture:getOpenedState',
    clearOpenedState: 'capture:clearOpenedState',
    getReplaySelection: 'capture:getReplaySelection',
    readLivePreview: 'capture:readLivePreview',
    getReplayState: 'capture:getReplayState',
    getRecovery: 'capture:getRecovery',
    restorePrevious: 'capture:restorePrevious',
    applyReplayEvent: 'capture:applyReplayEvent',
    refreshFrame: 'capture:refreshFrame',
  },
  context: {
    get: 'context:get',
  },
  trace: {
    getProjection: 'trace:getProjection',
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
    planReviewChanged: 'plan:reviewChanged',
    delegationChanged: 'conversation:delegationChanged',
  },
  workflow: {
    runStatusChanged: 'workflow:runStatusChanged',
    runUsageChanged: 'workflow:runUsageChanged',
    traceProjectionChanged: 'trace:projectionChanged',
  },
  llm: {
    effectiveCatalogChanged: 'llm:effectiveCatalogChanged',
    probeBatchChanged: 'llm:probeBatchChanged',
  },
  agent: {
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
    permissionStateChanged: 'runtime:permissionStateChanged',
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
