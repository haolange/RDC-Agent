import type { ContextUsageBreakdownId } from '@shared/types/session';
import type { TranslationKey } from '../i18n';

export const CONTEXT_BREAKDOWN_ORDER: ContextUsageBreakdownId[] = [
  'system_prompt',
  'memory_files',
  'skills',
  'system_tools',
  'mcp_tools',
  'mcp_tools_deferred',
  'builtin_tools_deferred',
  'subagent_definitions',
  'summarized_conversation',
  'conversation',
  'free',
];

export const CONTEXT_BREAKDOWN_GROUPS: {
  id: string;
  labelKey: TranslationKey;
  ids: ContextUsageBreakdownId[];
}[] = [
  { id: 'prompt', labelKey: 'contextBreakdown.groupPrompt', ids: ['system_prompt', 'memory_files', 'skills'] },
  {
    id: 'tools',
    labelKey: 'contextBreakdown.groupTools',
    ids: ['system_tools', 'mcp_tools', 'mcp_tools_deferred', 'builtin_tools_deferred', 'subagent_definitions'],
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
  builtin_tools_deferred: 'contextBreakdown.segment.builtin_tools_deferred',
  subagent_definitions: 'contextBreakdown.segment.subagent_definitions',
  summarized_conversation: 'contextBreakdown.segment.summarized_conversation',
  conversation: 'contextBreakdown.segment.conversation',
  free: 'contextBreakdown.segment.free',
};

export const COUNT_SUFFIX_KEYS: Partial<Record<ContextUsageBreakdownId, TranslationKey>> = {
  system_tools: 'contextBreakdown.countSuffix.system_tools',
  mcp_tools: 'contextBreakdown.countSuffix.mcp_tools',
  mcp_tools_deferred: 'contextBreakdown.countSuffix.mcp_tools_deferred',
  builtin_tools_deferred: 'contextBreakdown.countSuffix.builtin_tools_deferred',
  subagent_definitions: 'contextBreakdown.countSuffix.subagent_definitions',
  conversation: 'contextBreakdown.countSuffix.conversation',
};
