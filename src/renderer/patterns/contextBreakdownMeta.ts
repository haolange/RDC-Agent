import type { ContextUsageBreakdownId } from '@shared/types/session';
import type { TranslationKey } from '../i18n';

export const CONTEXT_BREAKDOWN_ORDER: ContextUsageBreakdownId[] = [
  'system_prompt',
  'memory_files',
  'skills',
  'system_tools',
  'mcp_tools',
  'mcp_tools_deferred',
  'subagent_definitions',
  'summarized_conversation',
  'conversation',
  'free',
];

/** Maps breakdown segment ids to Context-dedicated semantic color tokens. */
export const SEGMENT_COLOR_VAR: Record<ContextUsageBreakdownId, string> = {
  system_prompt: 'var(--token-context-system-prompt)',
  memory_files: 'var(--token-context-memory-files)',
  skills: 'var(--token-context-skills)',
  system_tools: 'var(--token-context-system-tools)',
  mcp_tools: 'var(--token-context-mcp-tools)',
  mcp_tools_deferred: 'var(--token-context-deferred)',
  subagent_definitions: 'var(--token-context-subagents)',
  summarized_conversation: 'var(--token-context-summarized)',
  conversation: 'var(--token-context-conversation)',
  free: 'var(--token-context-free)',
};

export const CONTEXT_BREAKDOWN_GROUPS: {
  id: string;
  labelKey: TranslationKey;
  ids: ContextUsageBreakdownId[];
}[] = [
  { id: 'prompt', labelKey: 'contextBreakdown.groupPrompt', ids: ['system_prompt', 'memory_files', 'skills'] },
  {
    id: 'tools',
    labelKey: 'contextBreakdown.groupTools',
    ids: ['system_tools', 'mcp_tools', 'mcp_tools_deferred', 'subagent_definitions'],
  },
  {
    id: 'conversation',
    labelKey: 'contextBreakdown.groupConversation',
    ids: ['summarized_conversation', 'conversation'],
  },
  { id: 'space', labelKey: 'contextBreakdown.groupSpace', ids: ['free'] },
];

export const SEGMENT_LABEL_KEYS: Record<ContextUsageBreakdownId, TranslationKey> = {
  system_prompt: 'contextBreakdown.segment.system_prompt',
  memory_files: 'contextBreakdown.segment.memoryFiles',
  skills: 'contextBreakdown.segment.skills',
  system_tools: 'contextBreakdown.segment.system_tools',
  mcp_tools: 'contextBreakdown.segment.mcp_tools',
  mcp_tools_deferred: 'contextBreakdown.segment.mcp_tools_deferred',
  subagent_definitions: 'contextBreakdown.segment.subagent_definitions',
  summarized_conversation: 'contextBreakdown.segment.summarized_conversation',
  conversation: 'contextBreakdown.segment.conversation',
  free: 'contextBreakdown.segment.free',
};

export const COUNT_SUFFIX_KEYS: Partial<Record<ContextUsageBreakdownId, TranslationKey>> = {
  system_tools: 'contextBreakdown.countSuffix.system_tools',
  mcp_tools: 'contextBreakdown.countSuffix.mcp_tools',
  mcp_tools_deferred: 'contextBreakdown.countSuffix.mcp_tools_deferred',
  subagent_definitions: 'contextBreakdown.countSuffix.subagent_definitions',
  conversation: 'contextBreakdown.countSuffix.conversation',
};
