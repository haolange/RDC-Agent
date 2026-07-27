import type { ConversationMessage, ConversationWorkBlock } from '@shared/types/conversation';

const collectToolNames = (blocks: ConversationWorkBlock[] | undefined, names: Set<string>): void => {
  for (const block of blocks ?? []) {
    for (const tool of block.toolCalls) {
      if (tool.status !== 'pending' && tool.toolName.trim()) names.add(tool.toolName.trim());
    }
    collectToolNames(block.children, names);
  }
};

/**
 * The durable conversation work trace is the canonical source for tools actually
 * used in a turn. Keep this main-owned so the renderer never infers resources
 * from tool cards or event payloads.
 */
export const collectSessionUsedToolNames = (messages: ConversationMessage[]): string[] => {
  const names = new Set<string>();
  for (const message of messages) {
    if (message.role === 'assistant') collectToolNames(message.workTrace?.blocks, names);
  }
  return [...names];
};
