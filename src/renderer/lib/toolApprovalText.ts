import type { Translator } from '../i18n/messages';

export const formatToolApprovalReason = (value: string | undefined, t: Translator): string => {
  const text = value?.trim() ?? '';
  if (!text) return '';
  const networkMatch = text.match(/^Network tool "([^"]+)" requires approval in the current permission mode.?$/i);
  if (networkMatch) return t('chat.approvalRequiredTool', { tool: networkMatch[1] });
  const toolMatch = text.match(/^Tool "([^"]+)" requires approval(?: before it can run)?.?$/i);
  if (toolMatch) return t('chat.approvalRequiredTool', { tool: toolMatch[1] });
  return text;
};

