import type { Translator, TranslationKey } from '../i18n/messages';

/** The human category of a tool ("命令执行", "文件读取"); MCP tools name their server; anything else is "工具". */
export function toolCategoryLabel(toolName: string, t: Translator): string {
  const key = `chat.toolDisplay.${toolName}.category` as TranslationKey;
  const label = t(key);
  if (label !== key) return label;
  const mcp = /^mcp__(.+)__([^_].*)$/.exec(toolName);
  return mcp ? t('composer.toolApprovalMcpTool', { server: mcp[1] }) : t('composer.toolApprovalGenericTool');
}
