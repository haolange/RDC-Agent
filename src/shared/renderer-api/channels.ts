import { AppError } from '../errors/appError';

/**
 * How the Browser QA bridge treats an invoke channel: `read` and `mutation` are allowed, `high-impact` needs
 * `RDC_AGENT_BROWSER_QA_FULL_ACCESS=1` (and is audited on every transport), `desktop-only` is always refused.
 */
export type BridgeChannelCapability = 'read' | 'mutation' | 'high-impact' | 'desktop-only';

/**
 * Every renderer invoke channel, one row each: its name and its Browser QA capability. The channel name type, the
 * preload allow-list, the main handler parity check and the bridge capability check all derive from this table.
 */
export const RENDERER_INVOKE_CHANNEL_TABLE = {
  'app:getMeta': 'read',
  'app:selectAvatar': 'desktop-only',
  'app:getAvatarDataUrl': 'desktop-only',
  'app:openPath': 'mutation',
  'app:copyText': 'mutation',
  'app:readClipboardText': 'read',
  'web:resolveFavicon': 'desktop-only',
  'web:fetchImage': 'desktop-only',
  'dialog:selectFiles': 'mutation',
  'dialog:selectRdcFiles': 'mutation',
  'dialog:selectKnowledgeImport': 'mutation',
  'dialog:selectDirectory': 'mutation',
  'window:minimize': 'desktop-only',
  'window:toggleMaximize': 'desktop-only',
  'window:close': 'desktop-only',
  'window:isMaximized': 'desktop-only',

  'conversation:sendMessage': 'mutation',
  'conversation:rewriteFromMessage': 'mutation',
  'conversation:cancelActiveTurn': 'mutation',
  'conversation:answerUserInput': 'high-impact',
  'conversation:answerToolApproval': 'high-impact',
  'conversation:answerPlanReview': 'high-impact',
  'conversation:getHistory': 'read',
  'conversation:getMessageSnapshot': 'read',
  'conversation:getDelegationTrace': 'read',
  'conversation:getDelegationContent': 'read',
  'conversation:switchBranch': 'mutation',
  'conversation:clearHistory': 'mutation',
  'conversation:undoLastTurn': 'mutation',
  'conversation:getToolImagePreview': 'read',
  'conversation:stageAttachments': 'mutation',
  'conversation:releaseAttachments': 'mutation',
  'conversation:getAttachmentPreview': 'read',
  // The scoped channel also opens and reveals local attachments after explicit renderer actions.
  'conversation:accessAttachment': 'mutation',
  'conversation:resolveMedia': 'read',

  'workflow:getState': 'read',
  'workflow:resume': 'mutation',
  'workflow:stop': 'mutation',
  'workflow:getRunUsage': 'read',

  'memory:issueApprovalToken': 'high-impact',
  'memory:list': 'read',
  'memory:get': 'read',
  'memory:write': 'mutation',
  'memory:delete': 'mutation',

  'investigation:read': 'read',
  'investigation:list': 'read',

  'plan:reopenReview': 'mutation',
  'plan:cancelReview': 'mutation',
  'plan:read': 'read',
  'plan:issueApprovalToken': 'high-impact',
  'plan:saveToProject': 'mutation',
  'plan:export': 'mutation',

  'knowledge:overview': 'read',
  'knowledge:topics:suggest': 'read',
  'knowledge:topics:preview': 'read',
  'knowledge:topics:apply': 'high-impact',
  'knowledge:query': 'read',
  'knowledge:card': 'read',
  'knowledge:compile': 'read',
  'knowledge:index:rebuild': 'mutation',
  'knowledge:candidates': 'read',
  'knowledge:candidateCreate': 'high-impact',
  // A preview reads a file the renderer names; from a browser that is as sensitive as importing it.
  'knowledge:previewImport': 'high-impact',
  'knowledge:import': 'high-impact',
  'knowledge:image': 'read',
  'knowledge:issueApprovalToken': 'high-impact',
  'knowledge:write': 'high-impact',
  'knowledge:promote': 'high-impact',
  'knowledge:export': 'high-impact',
  'knowledge:cancel': 'mutation',

  'rdc-runtime:overview': 'read',
  'rdc-runtime:validate': 'read',
  'rdc-runtime:upsert': 'high-impact',
  'rdc-runtime:import': 'high-impact',
  'rdc-runtime:delete': 'high-impact',
  'rdc-runtime:reveal': 'desktop-only',
  'rdc-runtime:trustHook': 'high-impact',
  'rdc-runtime:revokeHook': 'high-impact',
  'rdc-runtime:trustMcp': 'high-impact',
  'rdc-runtime:revokeMcp': 'high-impact',
  'rdc-runtime:testHook': 'high-impact',
  'rdc-runtime:listSnapshots': 'read',
  'rdc-runtime:getSnapshot': 'read',

  'command:list': 'read',
  'command:execute': 'high-impact',

  'tool:detectInstallations': 'read',
  'tool:resolveInstallation': 'read',
  'tool:verifyInstallation': 'high-impact',
  'mcp:getStatusSummary': 'read',
  'evidence:getChain': 'read',

  'llm:testProviderDraft': 'read',
  'llm:testModelCapability': 'read',
  'llm:prepareProbeBatch': 'read',
  'llm:startProbeBatch': 'read',
  'llm:cancelProbeBatch': 'mutation',
  'llm:getProbeBatch': 'read',
  'llm:connectProvider': 'high-impact',
  'llm:refreshProviderModels': 'read',
  'llm:disconnectProvider': 'high-impact',
  'llm:startProviderAccountLogin': 'high-impact',
  'llm:getProviderAccountStatus': 'read',
  'llm:finishProviderAccountLogin': 'high-impact',
  'llm:cancelProviderAccountLogin': 'mutation',
  'llm:logoutProviderAccount': 'high-impact',

  'settings:get': 'read',
  'settings:getProviderCatalog': 'read',
  'settings:getEffectiveModel': 'read',
  'settings:getEffectiveCatalog': 'read',
  'settings:hasProviderSecret': 'read',
  'settings:importAgentManifest': 'high-impact',
  'settings:saveAgentDefinition': 'high-impact',
  'settings:getAgentDefinitionCommit': 'read',
  'settings:previewAgentModelMigration': 'read',
  'settings:applyAgentModelMigration': 'high-impact',
  'settings:deleteAgentOverrideFile': 'high-impact',
  'settings:previewProjectAgentTrust': 'read',
  'settings:trustProjectAgent': 'high-impact',
  'settings:getAgentBuiltinComparison': 'read',
  'settings:saveProviderDefinition': 'high-impact',
  'settings:getProviderDefinitionCommit': 'read',
  'settings:getModelsOverride': 'read',
  'settings:setModelsOverride': 'high-impact',
  'settings:getResolvedShell': 'read',
  'settings:patch': 'high-impact',

  'project:list': 'read',
  'project:add': 'mutation',
  'project:select': 'mutation',
  'project:rename': 'mutation',
  'project:remove': 'mutation',
  'project:inputs:list': 'read',
  'project:inputs:refresh': 'mutation',
  'project:inputs:import': 'mutation',
  'project:inputs:importPaths': 'mutation',
  'project:inputs:reference': 'high-impact',
  'project:inputs:prepareRemove': 'high-impact',
  'project:inputs:remove': 'high-impact',

  'device:prepare': 'high-impact',
  'device:cancelPreparation': 'mutation',
  'device:list': 'read',
  'device:refresh': 'mutation',
  'device:watch:start': 'mutation',
  'device:watch:renew': 'mutation',
  'device:watch:stop': 'mutation',

  'session:list': 'read',
  'session:create': 'mutation',
  'session:rename': 'mutation',
  'session:remove': 'mutation',
  'session:open': 'mutation',
  'session:setModelOverride': 'mutation',
  'session:setAgentId': 'mutation',
  'session:applyDeclaredHandoff': 'mutation',

  'runtimeLog:list': 'read',
  'runtime:getPermissionState': 'read',

  'capture:list': 'read',
  'capture:select': 'mutation',
  'capture:openProjectInput': 'mutation',
  'capture:getOpenedState': 'read',
  'capture:clearOpenedState': 'mutation',
  'capture:getReplaySelection': 'read',
  'capture:readLivePreview': 'read',
  'capture:getReplayState': 'read',
  'capture:getRecovery': 'read',
  'capture:restorePrevious': 'high-impact',
  'capture:applyReplayEvent': 'mutation',
  'capture:refreshFrame': 'mutation',

  'context:get': 'read',

  'trace:getProjection': 'read',
} as const satisfies Record<string, BridgeChannelCapability>;

/** Every channel main pushes to the renderer. */
export const RENDERER_EVENT_CHANNELS = Object.freeze([
  'file:open',
  'case:new',
  'settings:open',
  'app:themeChanged',
  'window:maximized-changed',

  'conversation:event',
  'plan:reviewChanged',
  'conversation:delegationChanged',

  'session:recordChanged',

  'workflow:runStatusChanged',
  'workflow:runUsageChanged',
  'trace:projectionChanged',

  'llm:effectiveCatalogChanged',
  'llm:probeBatchChanged',

  'knowledge:progress',

  'tool:executionComplete',
  'evidence:eventAdded',

  'device:statusChanged',
  'capture:statusChanged',
  'context:changed',
  'project:inputsChanged',
  'project:inputsError',
  'capture:openedStateChanged',
  'capture:replayChanged',

  'runtime:logAppended',
  'runtime:permissionStateChanged',

  'settings:changed',
] as const);

export type RendererInvokeChannel = keyof typeof RENDERER_INVOKE_CHANNEL_TABLE;
export type RendererEventChannel = (typeof RENDERER_EVENT_CHANNELS)[number];

export const RENDERER_INVOKE_CHANNELS = Object.freeze(
  Object.keys(RENDERER_INVOKE_CHANNEL_TABLE),
) as readonly RendererInvokeChannel[];

const rendererEventChannelSet = new Set<string>(RENDERER_EVENT_CHANNELS);

export function isRendererInvokeChannel(channel: string): channel is RendererInvokeChannel {
  return Object.prototype.hasOwnProperty.call(RENDERER_INVOKE_CHANNEL_TABLE, channel);
}

export function isRendererEventChannel(channel: string): channel is RendererEventChannel {
  return rendererEventChannelSet.has(channel);
}

/** The capability of a declared channel; an undeclared channel fails closed. */
export function resolveBridgeChannelCapability(channel: string): BridgeChannelCapability {
  if (!isRendererInvokeChannel(channel)) throw new AppError('BRIDGE_CAPABILITY_MISSING', channel);
  return RENDERER_INVOKE_CHANNEL_TABLE[channel];
}

/** High-impact channels are confirmed and audited on every transport. */
export function isHighImpactChannel(channel: string): boolean {
  return isRendererInvokeChannel(channel) && RENDERER_INVOKE_CHANNEL_TABLE[channel] === 'high-impact';
}
