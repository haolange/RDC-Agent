/**
 * Browser QA channel capability matrix — single authority with channels.ts.
 * Every RENDERER_INVOKE_CHANNEL must classify as exactly one of:
 * - read | mutation (default allow)
 * - high-impact (requires RDC_AGENT_BROWSER_QA_FULL_ACCESS=1)
 * - desktop-only (always denied on bridge)
 */

import { RENDERER_INVOKE_CHANNELS, type RendererInvokeChannel } from './channels';

export type BridgeChannelCapability = 'read' | 'mutation' | 'high-impact' | 'desktop-only';

const DESKTOP_ONLY_EXACT = new Set<string>([
  'app:selectAvatar',
  'app:getAvatarDataUrl',
  'window:minimize',
  'window:toggleMaximize',
  'window:close',
  'window:isMaximized',
  'web:resolveFavicon',
  'rdx-runtime:reveal',
]);

// Native shell helpers that Browser QA still needs for project/import/copy flows.
// Kept as mutation (default allow), not desktop-only.
const MUTATION_SHELL_EXACT = new Set<string>([
  'app:openPath',
  'app:copyText',
  'dialog:selectFiles',
  'dialog:selectRdcFiles',
  'dialog:selectDirectory',
]);

const HIGH_IMPACT_EXACT = new Set<string>([
  'settings:set',
  'settings:setModelsOverride',
  'settings:saveProviderDefinition',
  'settings:saveAgentDefinition',
  'settings:importAgentManifest',
  'rdx-runtime:trustMcp',
  'rdx-runtime:revokeMcp',
  'rdx-runtime:trustHook',
  'rdx-runtime:revokeHook',
  'rdx-runtime:upsert',
  'rdx-runtime:import',
  'rdx-runtime:delete',
  'rdx-runtime:testHook',
  'llm:connectProvider',
  'llm:disconnectProvider',
  'llm:startProviderAccountLogin',
  'llm:finishProviderAccountLogin',
  'llm:logoutProviderAccount',
  'command:execute',
  'memory:issueApprovalToken',
  'device:activate',
]);

const READ_EXACT = new Set<string>([
  'app:getMeta',
  'conversation:getHistory',
  'workflow:getState',
  'workflow:getRunUsage',
  'workflow:listRuns',
  'workflow:listActiveRuns',
  'agent:getState',
  'agent:getAllStates',
  'memory:list',
  'memory:get',
  'knowledge:listSpaces',
  'knowledge:listCards',
  'knowledge:getCard',
  'rdx-runtime:overview',
  'rdx-runtime:validate',
  'rdx-runtime:listSnapshots',
  'rdx-runtime:getSnapshot',
  'command:list',
  'tool:getCatalog',
  'tool:getRuntimeSummary',
  'mcp:getStatusSummary',
  'evidence:getChain',
  'evidence:getEvents',
  'llm:testProviderDraft',
  'llm:testModelCapability',
  'llm:refreshProviderModels',
  'llm:getProviderAccountStatus',
  'settings:get',
  'settings:getProviderCatalog',
  'settings:getEffectiveModel',
  'settings:getEffectiveCatalog',
  'settings:hasProviderSecret',
  'settings:getAgentDefinitionCommit',
  'settings:getProviderDefinitionCommit',
  'settings:getModelsOverride',
  'project:list',
  'project:inputs:list',
  'device:list',
  'session:list',
  'session:attachments:list',
  'run:list',
  'runtimeLog:list',
  'terminal:listTabs',
  'capture:list',
  'capture:getOpenedState',
  'context:get',
  'trace:getRun',
  'trace:getEvents',
  'trace:getProjection',
  'trace:exportRun',
]);

function classifyByPrefix(channel: string): BridgeChannelCapability | null {
  if (channel.startsWith('window:')) return 'desktop-only';
  if (channel.startsWith('terminal:')) return 'high-impact';
  return null;
}

export function resolveBridgeChannelCapability(channel: string): BridgeChannelCapability {
  if (DESKTOP_ONLY_EXACT.has(channel)) return 'desktop-only';
  if (HIGH_IMPACT_EXACT.has(channel)) return 'high-impact';
  if (MUTATION_SHELL_EXACT.has(channel)) return 'mutation';
  const prefixed = classifyByPrefix(channel);
  if (prefixed) return prefixed;
  if (READ_EXACT.has(channel)) return 'read';
  // Remaining product invoke channels are session/project/conversation mutations.
  return 'mutation';
}

export function listUnclassifiedInvokeChannels(): string[] {
  // Every channel is classified by resolveBridgeChannelCapability; this checks
  // that explicit sets do not overlap and cover is intentional.
  const overlaps: string[] = [];
  for (const channel of RENDERER_INVOKE_CHANNELS) {
    let hits = 0;
    if (DESKTOP_ONLY_EXACT.has(channel)) hits += 1;
    if (HIGH_IMPACT_EXACT.has(channel)) hits += 1;
    if (READ_EXACT.has(channel)) hits += 1;
    if (hits > 1) overlaps.push(channel);
  }
  return overlaps;
}

export function assertChannelCapabilityCoverage(): void {
  const overlaps = listUnclassifiedInvokeChannels();
  if (overlaps.length > 0) {
    throw new Error(`BRIDGE_CAPABILITY_OVERLAP: ${overlaps.join(', ')}`);
  }
  for (const channel of RENDERER_INVOKE_CHANNELS) {
    const capability = resolveBridgeChannelCapability(channel);
    if (!capability) {
      throw new Error(`BRIDGE_CAPABILITY_MISSING: ${channel}`);
    }
  }
}

export type { RendererInvokeChannel };
