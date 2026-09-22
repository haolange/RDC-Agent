import { type ConversationWorkBlock } from '@shared/types/conversation';

const NOISY_TEXT_PATTERNS = [
  /agent loop/i,
  /model and tool loop/i,
  /^context compacted\b/i,
  /final answer/i,
  /response complete/i,
  /reply completed/i,
  /assistant output ready/i,
  /start agent loop/i,
  /回复已完成/,
  /回答已完成/,
];

export const getMeaningfulBlockSummary = (block: ConversationWorkBlock): string => {
  const candidates = [block.summary, block.title].map((value) => value?.trim()).filter(Boolean) as string[];
  return candidates.find((value) => isMeaningfulText(value)) ?? '';
};

export const isMeaningfulText = (value?: string): value is string => Boolean(value?.trim()) && !isNoisyText(value);

export const isNoisyText = (value?: string): boolean => {
  const text = value?.trim();
  if (!text) return true;
  return NOISY_TEXT_PATTERNS.some((pattern) => pattern.test(text));
};
