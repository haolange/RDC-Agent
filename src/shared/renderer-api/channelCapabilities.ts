/**
 * Browser QA channel capability matrix — closed map with channels.ts.
 * Every RENDERER_INVOKE_CHANNEL must be listed here; missing keys fail TypeScript
 * compile, unknown runtime channels fail-closed.
 */

import { RENDERER_INVOKE_CHANNELS, type RendererInvokeChannel } from './channels';

export type BridgeChannelCapability = 'read' | 'mutation' | 'high-impact' | 'desktop-only';

export const CHANNEL_CAPABILITY: Record<RendererInvokeChannel, BridgeChannelCapability> = {
  'app:getMeta': 'read',
  'app:selectAvatar': 'desktop-only',
  'app:getAvatarDataUrl': 'desktop-only',
  'app:openPath': 'mutation',
  'app:copyText': 'mutation',
  'web:resolveFavicon': 'desktop-only',
  'dialog:selectFiles': 'mutation',
  'dialog:selectRdcFiles': 'mutation',
  'dialog:selectDirectory': 'mutation',
  'window:minimize': 'desktop-only',
  'window:toggleMaximize': 'desktop-only',
  'window:close': 'desktop-only',
  'window:isMaximized': 'desktop-only',
  'conversation:sendMessage': 'mutation',
  'conversation:rewriteFromMessage': 'mutation',
  'conversation:cancelActiveTurn': 'mutation',
  'conversation:answerUserInput': 'mutation',
  'conversation:answerToolApproval': 'mutation',
  'conversation:getHistory': 'read',
  'conversation:switchBranch': 'mutation',
  'conversation:clearHistory': 'mutation',
  'conversation:undoLastTurn': 'mutation',
  'conversation:compactHistory': 'mutation',
  'conversation:getToolImagePreview': 'read',
  'workflow:getState': 'read',
  'workflow:resume': 'mutation',
  'workflow:stop': 'mutation',
  'workflow:getRunUsage': 'read',
  'workflow:listRuns': 'read',
  'workflow:listActiveRuns': 'read',
  'agent:sendMessage': 'mutation',
  'agent:getState': 'read',
  'agent:getAllStates': 'read',
  'agent:configure': 'mutation',
  'memory:issueApprovalToken': 'high-impact',
  'memory:list': 'read',
  'memory:get': 'read',
  'memory:write': 'mutation',
  'memory:delete': 'mutation',
  'knowledge:listSpaces': 'read',
  'knowledge:listCards': 'read',
  'knowledge:getCard': 'read',
  'rdx-runtime:overview': 'read',
  'rdx-runtime:validate': 'read',
  'rdx-runtime:upsert': 'high-impact',
  'rdx-runtime:import': 'high-impact',
  'rdx-runtime:delete': 'high-impact',
  'rdx-runtime:reveal': 'desktop-only',
  'rdx-runtime:trustHook': 'high-impact',
  'rdx-runtime:revokeHook': 'high-impact',
  'rdx-runtime:trustMcp': 'high-impact',
  'rdx-runtime:revokeMcp': 'high-impact',
  'rdx-runtime:testHook': 'high-impact',
  'rdx-runtime:listSnapshots': 'read',
  'rdx-runtime:getSnapshot': 'read',
  'command:list': 'read',
  'command:execute': 'high-impact',
  'tool:getCatalog': 'read',
  'tool:getRuntimeSummary': 'read',
  'mcp:getStatusSummary': 'read',
  'evidence:getChain': 'read',
  'evidence:getEvents': 'read',
  'llm:testProviderDraft': 'read',
  'llm:testModelCapability': 'read',
  'llm:connectProvider': 'high-impact',
  'llm:refreshProviderModels': 'read',
  'llm:disconnectProvider': 'high-impact',
  'llm:startProviderAccountLogin': 'high-impact',
  'llm:getProviderAccountStatus': 'read',
  'llm:finishProviderAccountLogin': 'high-impact',
  'llm:logoutProviderAccount': 'high-impact',
  'settings:get': 'read',
  'settings:getProviderCatalog': 'read',
  'settings:getEffectiveModel': 'read',
  'settings:getEffectiveCatalog': 'read',
  'settings:hasProviderSecret': 'read',
  'settings:importAgentManifest': 'high-impact',
  'settings:saveAgentDefinition': 'high-impact',
  'settings:getAgentDefinitionCommit': 'read',
  'settings:saveProviderDefinition': 'high-impact',
  'settings:getProviderDefinitionCommit': 'read',
  'settings:getModelsOverride': 'read',
  'settings:setModelsOverride': 'high-impact',
  'settings:set': 'high-impact',
  'project:list': 'read',
  'project:add': 'mutation',
  'project:select': 'mutation',
  'project:rename': 'mutation',
  'project:remove': 'mutation',
  'project:inputs:list': 'read',
  'project:inputs:refresh': 'mutation',
  'project:inputs:import': 'mutation',
  'project:inputs:importPaths': 'mutation',
  'device:list': 'read',
  'device:refresh': 'mutation',
  'device:activate': 'high-impact',
  'device:watch:start': 'mutation',
  'device:watch:renew': 'mutation',
  'device:watch:stop': 'mutation',
  'session:list': 'read',
  'session:create': 'mutation',
  'session:rename': 'mutation',
  'session:remove': 'mutation',
  'session:select': 'mutation',
  'session:setModelOverride': 'mutation',
  'session:attachments:list': 'read',
  'session:attachments:import': 'mutation',
  'run:list': 'read',
  'runtimeLog:list': 'read',
  'terminal:listTabs': 'high-impact',
  'terminal:createTab': 'high-impact',
  'terminal:closeTab': 'high-impact',
  'terminal:activateTab': 'high-impact',
  'terminal:write': 'high-impact',
  'terminal:resize': 'high-impact',
  'capture:list': 'read',
  'capture:select': 'mutation',
  'capture:openProjectInput': 'mutation',
  'capture:getOpenedState': 'read',
  'capture:clearOpenedState': 'mutation',
  'context:get': 'read',
  'context:openHumanPreview': 'mutation',
  'context:closeHumanPreview': 'mutation',
  'trace:getRun': 'read',
  'trace:getEvents': 'read',
  'trace:getProjection': 'read',
  'trace:exportRun': 'read',
  'trace:switchBranch': 'mutation',
};

export function hasBridgeChannelCapability(channel: string): channel is RendererInvokeChannel {
  return Object.prototype.hasOwnProperty.call(CHANNEL_CAPABILITY, channel);
}

export function resolveBridgeChannelCapability(channel: string): BridgeChannelCapability {
  if (!hasBridgeChannelCapability(channel)) {
    throw new Error(`BRIDGE_CAPABILITY_MISSING: ${channel}`);
  }
  return CHANNEL_CAPABILITY[channel];
}

export function listUnclassifiedInvokeChannels(): string[] {
  return RENDERER_INVOKE_CHANNELS.filter((channel) => !hasBridgeChannelCapability(channel));
}

export function assertChannelCapabilityCoverage(): void {
  const mapped = new Set(Object.keys(CHANNEL_CAPABILITY));
  const missing = listUnclassifiedInvokeChannels();
  if (missing.length > 0) {
    throw new Error(`BRIDGE_CAPABILITY_MISSING: ${missing.join(', ')}`);
  }
  const extra = [...mapped].filter((channel) => !RENDERER_INVOKE_CHANNELS.includes(channel as RendererInvokeChannel));
  if (extra.length > 0) {
    throw new Error(`BRIDGE_CAPABILITY_EXTRA: ${extra.join(', ')}`);
  }
  for (const channel of RENDERER_INVOKE_CHANNELS) {
    resolveBridgeChannelCapability(channel);
  }
}

export type { RendererInvokeChannel };
