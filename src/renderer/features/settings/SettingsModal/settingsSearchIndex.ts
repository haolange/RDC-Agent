import type { TranslationKey } from '../../../i18n';
import type { SettingsSection } from './types';

export interface SettingsSearchEntry {
  id: string;
  section: SettingsSection;
  titleKey: TranslationKey;
  keywords: string[];
  target: string;
}

export const SETTINGS_SEARCH_INDEX: SettingsSearchEntry[] = [
  {
    id: 'general',
    section: 'general',
    titleKey: 'settings.general',
    keywords: ['general', 'profile', 'account', '通用', '资料', '账号'],
    target: 'general',
  },
  {
    id: 'language',
    section: 'general',
    titleKey: 'userMenu.language',
    keywords: ['language', 'locale', 'chinese', 'english', '语言', '中文', '英文'],
    target: 'language',
  },
  {
    id: 'personalization',
    section: 'general',
    titleKey: 'settings.personalization',
    keywords: ['instructions', 'personalization', '个性化', '指令'],
    target: 'general',
  },
  {
    id: 'appearance',
    section: 'appearance',
    titleKey: 'settings.appearance',
    keywords: ['theme', 'appearance', '外观', '主题'],
    target: 'appearance',
  },
  {
    id: 'font-scale',
    section: 'appearance',
    titleKey: 'userMenu.fontScale',
    keywords: ['font', 'scale', 'size', '字体', '字号'],
    target: 'font-scale',
  },
  {
    id: 'resource-diagnostics',
    section: 'general',
    titleKey: 'settings.resourceDiagnosticsTitle',
    keywords: ['workspace', 'paths', 'rdx', 'runtime', 'root', 'diagnostics', '工作区', '路径', '资源', '诊断', '根目录'],
    target: 'resource-diagnostics',
  },
  {
    id: 'models',
    section: 'models',
    titleKey: 'settings.models',
    keywords: ['models', 'providers', 'llm', '模型', '供应商'],
    target: 'models',
  },
  {
    id: 'agents',
    section: 'agents',
    titleKey: 'settings.agentManifestTitle',
    keywords: ['agents', 'manifest', 'profile', '代理', '清单'],
    target: 'agents',
  },
  {
    id: 'skills',
    section: 'skills',
    titleKey: 'settings.skills',
    keywords: ['skills', 'skill', '技能'],
    target: 'skills',
  },
  {
    id: 'tools',
    section: 'tools',
    titleKey: 'settings.toolsAndExtensions',
    keywords: ['tools', 'mcp', 'cli', 'shell', 'pwsh', 'powershell', '工具', '扩展', '终端'],
    target: 'tools',
  },
  {
    id: 'agent-shell',
    section: 'tools',
    titleKey: 'settings.shellTitle',
    keywords: ['shell', 'pwsh', 'powershell', 'bash', 'zsh', 'terminal', '终端', '命令'],
    target: 'agent-shell',
  },
  {
    id: 'code-interpreter',
    section: 'tools',
    titleKey: 'settings.codeInterpreterTitle',
    keywords: ['interpreter', 'python', 'code', 'env', '解释器', '环境变量'],
    target: 'code-interpreter',
  },
  {
    id: 'hooks',
    section: 'hooks',
    titleKey: 'settings.hooks',
    keywords: ['hooks', 'hook', '钩子'],
    target: 'hooks',
  },
  {
    id: 'policy',
    section: 'policy',
    titleKey: 'settings.policy',
    keywords: ['policy', 'permissions', '策略', '权限'],
    target: 'policy',
  },
  {
    id: 'compaction',
    section: 'policy',
    titleKey: 'settings.compactionThreshold',
    keywords: ['compaction', 'context', 'threshold', '压缩', '阈值', '上下文'],
    target: 'compaction',
  },
];

export function matchSettingsSearchEntries(
  query: string,
  titleOf: (key: TranslationKey) => string,
): SettingsSearchEntry[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  return SETTINGS_SEARCH_INDEX.filter((entry) => {
    const haystack = [titleOf(entry.titleKey), entry.section, ...entry.keywords]
      .join(' ')
      .toLowerCase();
    return haystack.includes(normalized);
  });
}
