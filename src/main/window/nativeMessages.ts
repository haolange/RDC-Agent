import type { AppLanguage } from '@shared/types/settings';

export const nativeEnglish = {
  allowOnce: 'Allow once', cancel: 'Cancel',
  memoryTitle: 'Confirm memory change', memoryWrite: 'Save this memory entry?', memoryDelete: 'Delete this memory entry?',
  userScope: 'User', projectScope: 'Project',
  knowledgeTitle: 'Confirm knowledge change', knowledgeWrite: 'Save this knowledge card?', knowledgePromote: 'Promote or change this knowledge card?',
  planTitle: 'Confirm plan file write', planSave: 'Save this plan into the project?', planExport: 'Export this plan to a file?',
  session: 'Session {id}',
  captureFilter: 'RenderDoc captures', knowledgeFilter: 'Knowledge packages', caseFilter: 'Case YAML', imageFilter: 'Images',
  selectCaptures: 'Select RenderDoc captures', selectKnowledge: 'Select a knowledge package', selectFiles: 'Select files',
  selectDirectory: 'Select a folder', saveFile: 'Save file', selectAvatar: 'Select an avatar', exportPlan: 'Export plan',
  file: 'File', openCapture: 'Open .rdc File', newCase: 'New Case', settings: 'Settings', edit: 'Edit', view: 'View', help: 'Help',
  documentation: 'Documentation', reportIssue: 'Report Issue', about: 'About RDC-Agent', version: 'Version: {version}',
  selectedCaptures: 'Selected {count} external .rdc files.',
  pastedText: 'Pasted text ({count} characters)',
  trust: 'Trust', trustTitle: 'Trust a project resource',
  trustHook: 'Let hook "{id}" run on Agent events?', trustMcp: 'Let MCP server "{id}" start and give the Agent its tools?',
  trustAgent: 'Use project Agent "{id}" in this project?',
} as const;

export type NativeMessageKey = keyof typeof nativeEnglish;

export const nativeChinese: Record<NativeMessageKey, string> = {
  allowOnce: '允许一次', cancel: '取消',
  memoryTitle: '确认更改记忆', memoryWrite: '保存这条记忆？', memoryDelete: '删除这条记忆？',
  userScope: '用户', projectScope: '项目',
  knowledgeTitle: '确认更改知识', knowledgeWrite: '保存这张知识卡片？', knowledgePromote: '提升或更改这张知识卡片？',
  planTitle: '确认写入计划文件', planSave: '将这个计划保存到项目？', planExport: '将这个计划导出到文件？',
  session: '会话 {id}',
  captureFilter: 'RenderDoc 抓帧', knowledgeFilter: '知识包', caseFilter: '案例 YAML', imageFilter: '图片',
  selectCaptures: '选择 RenderDoc 抓帧', selectKnowledge: '选择知识包', selectFiles: '选择文件',
  selectDirectory: '选择文件夹', saveFile: '保存文件', selectAvatar: '选择头像', exportPlan: '导出计划',
  file: '文件', openCapture: '打开 .rdc 文件', newCase: '新建案例', settings: '设置', edit: '编辑', view: '视图', help: '帮助',
  documentation: '使用文档', reportIssue: '报告问题', about: '关于 RDC-Agent', version: '版本：{version}',
  selectedCaptures: '已选择 {count} 个外部 .rdc 文件。',
  pastedText: '粘贴的文本（{count} 个字符）',
  trust: '信任', trustTitle: '信任项目资源',
  trustHook: '允许钩子「{id}」在智能体事件上运行？', trustMcp: '允许 MCP 服务「{id}」启动并向智能体提供工具？',
  trustAgent: '在这个项目里使用项目智能体「{id}」？',
};

export function nativeText(language: AppLanguage, key: NativeMessageKey, params?: Record<string, string | number>): string {
  const message = (language === 'en' ? nativeEnglish : nativeChinese)[key];
  return message.replace(/\{(\w+)\}/g, (placeholder, name: string) => params?.[name] == null ? placeholder : String(params[name]));
}
