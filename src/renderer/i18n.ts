import { useMemo } from 'react';
import type { AppLanguage } from '@shared/types/settings';
import { useAppSettingsStore } from './stores/appSettingsStore';

export type TranslationKey =
  | 'app.connected'
  | 'app.degraded'
  | 'app.offline'
  | 'app.inputPlaceholder'
  | 'app.notice.filesReceived'
  | 'app.notice.newWorkspace'
  | 'mode.debugger'
  | 'mode.analyzer'
  | 'mode.optimizer'
  | 'sidebar.newTask'
  | 'sidebar.sessionHistory'
  | 'sidebar.history'
  | 'sidebar.refresh'
  | 'sidebar.noRuns'
  | 'sidebar.noRunsHint'
  | 'sidebar.projects'
  | 'sidebar.addProject'
  | 'sidebar.removeProject'
  | 'sidebar.noProjects'
  | 'sidebar.noProjectsHint'
  | 'sidebar.sessions'
  | 'sidebar.addSession'
  | 'sidebar.noSessions'
  | 'sidebar.noSessionsHint'
  | 'sidebar.projectRequired'
  | 'sidebar.userName'
  | 'sidebar.userSubtitle'
  | 'sidebar.userSettings'
  | 'userMenu.language'
  | 'userMenu.theme'
  | 'userMenu.fontScale'
  | 'userMenu.settings'
  | 'theme.dark'
  | 'theme.light'
  | 'theme.system'
  | 'font.small'
  | 'font.medium'
  | 'font.large'
  | 'settings.title'
  | 'settings.account'
  | 'settings.general'
  | 'settings.workspace'
  | 'settings.models'
  | 'settings.agents'
  | 'settings.accountTitle'
  | 'settings.accountSubtitle'
  | 'settings.avatar'
  | 'settings.avatarHint'
  | 'settings.uploadAvatar'
  | 'settings.nickname'
  | 'settings.save'
  | 'settings.generalTitle'
  | 'settings.generalSubtitle'
  | 'settings.workspaceTitle'
  | 'settings.workspaceSubtitle'
  | 'settings.workspaceRoot'
  | 'settings.workspaceRootHint'
  | 'settings.chooseDirectory'
  | 'settings.resetWorkspace'
  | 'settings.settingsFile'
  | 'settings.logFile'
  | 'settings.projectsPath'
  | 'settings.knowledgePath'
  | 'settings.reveal'
  | 'settings.copy'
  | 'settings.modelsTitle'
  | 'settings.modelsSubtitle'
  | 'settings.modelSettings'
  | 'settings.agentsSubtitle'
  | 'settings.agentsHint'
  | 'settings.provider'
  | 'settings.providerFieldLabel'
  | 'settings.providerKind'
  | 'settings.providerConfigured'
  | 'settings.providerUnconfigured'
  | 'settings.apiKeyList'
  | 'settings.add'
  | 'settings.addProvider'
  | 'settings.unsaved'
  | 'settings.emptyCredentials'
  | 'settings.label'
  | 'settings.apiKey'
  | 'settings.getApiKey'
  | 'settings.showSecret'
  | 'settings.hideSecret'
  | 'settings.baseUrl'
  | 'settings.modelsEnabled'
  | 'settings.addModel'
  | 'settings.addModelPlaceholder'
  | 'settings.recommendedModels'
  | 'settings.unnamedProvider'
  | 'settings.emptyProvidersTitle'
  | 'settings.emptyProvidersHint'
  | 'settings.agentRouting'
  | 'settings.modelFieldLabel'
  | 'settings.invalidRoute'
  | 'settings.noModelsAvailable'
  | 'settings.noConfiguredProviders'
  | 'settings.selectProviderPlaceholder'
  | 'settings.selectProviderFirst'
  | 'settings.routeReasonNoProvider'
  | 'settings.routeReasonProviderUnavailable'
  | 'settings.routeReasonNoModels'
  | 'settings.routeReasonModelInvalid'
  | 'settings.saveAgentRouting'
  | 'settings.delete'
  | 'settings.discard'
  | 'settings.noSelection'
  | 'control.taskMonitor'
  | 'control.captureControl'
  | 'control.contextInfo'
  | 'control.projectInputs';

const translations: Record<AppLanguage, Record<TranslationKey, string>> = {
  'zh-CN': {
    'app.connected': 'Connected',
    'app.degraded': 'Degraded',
    'app.offline': 'Offline',
    'app.inputPlaceholder': '描述任务，调用技能与工具',
    'app.notice.filesReceived': '已接收 {count} 个文件，请在 Debugger 页面确认。',
    'app.notice.newWorkspace': '已创建新的调试工作区。',
    'mode.debugger': 'Debugger',
    'mode.analyzer': 'Analyzer',
    'mode.optimizer': 'Optimizer',
    'sidebar.newTask': '新任务',
    'sidebar.sessionHistory': 'Session历史',
    'sidebar.history': '历史记录',
    'sidebar.refresh': '刷新',
    'sidebar.noRuns': '暂无历史 Run',
    'sidebar.noRunsHint': '完成一次调试后会显示在这里',
    'sidebar.projects': '项目',
    'sidebar.addProject': '添加项目',
    'sidebar.removeProject': '移除项目',
    'sidebar.noProjects': '暂无项目',
    'sidebar.noProjectsHint': '点击右上角添加本地项目目录',
    'sidebar.sessions': '线程',
    'sidebar.addSession': '新线程',
    'sidebar.noSessions': '暂无线程',
    'sidebar.noSessionsHint': '先创建线程或直接开始一次新的调试',
    'sidebar.projectRequired': '请先添加并选择一个项目',
    'sidebar.userName': 'RDC Operator',
    'sidebar.userSubtitle': 'Desktop config',
    'sidebar.userSettings': '用户设置',
    'userMenu.language': '语言',
    'userMenu.theme': '主题',
    'userMenu.fontScale': '字体大小',
    'userMenu.settings': '设置中心',
    'theme.dark': 'Dark',
    'theme.light': 'Light',
    'theme.system': 'System',
    'font.small': 'Small',
    'font.medium': 'Medium',
    'font.large': 'Large',
    'settings.title': '设置',
    'settings.account': '账号',
    'settings.general': '通用',
    'settings.workspace': '工作区',
    'settings.models': '模型',
    'settings.agents': 'Agent',
    'settings.accountTitle': '账号',
    'settings.accountSubtitle': '管理本地资料与显示名称。',
    'settings.avatar': '头像',
    'settings.avatarHint': '点击上传本地头像，建议使用正方形图片。',
    'settings.uploadAvatar': '上传头像',
    'settings.nickname': '昵称',
    'settings.save': '保存',
    'settings.generalTitle': '通用',
    'settings.generalSubtitle': '配置主题、语言和界面字号。',
    'settings.workspaceTitle': '工作区',
    'settings.workspaceSubtitle': '设置唯一工作目录，并查看其派生的数据路径。',
    'settings.workspaceRoot': '工作目录',
    'settings.workspaceRootHint': '运行数据、settings.json 和日志都从这个目录派生。',
    'settings.chooseDirectory': '选择目录',
    'settings.resetWorkspace': '恢复默认',
    'settings.settingsFile': 'settings.json',
    'settings.logFile': '日志文件',
    'settings.projectsPath': '项目目录',
    'settings.knowledgePath': '知识库目录',
    'settings.reveal': '打开位置',
    'settings.copy': '复制路径',
    'settings.modelsTitle': '模型',
    'settings.modelsSubtitle': '管理 LLM Provider 与可用模型。',
    'settings.modelSettings': 'Provider 配置',
    'settings.agentsSubtitle': '为每个 Agent 单独配置 Provider 与模型。',
    'settings.agentsHint': '每个 Agent 先选择供应商，再选择该供应商下的具体模型。',
    'settings.provider': '供应商',
    'settings.providerFieldLabel': '供应商',
    'settings.providerKind': '接入类型',
    'settings.providerConfigured': '已配置',
    'settings.providerUnconfigured': '未配置',
    'settings.apiKeyList': 'API Key List',
    'settings.add': '新增',
    'settings.addProvider': '新增 Provider',
    'settings.unsaved': '未保存',
    'settings.emptyCredentials': '当前 Provider 还没有配置，先新增一条 API Key。',
    'settings.label': '标签',
    'settings.apiKey': 'API 密钥',
    'settings.getApiKey': '获取 API 密钥',
    'settings.showSecret': '显示密钥',
    'settings.hideSecret': '隐藏密钥',
    'settings.baseUrl': 'API Base URL',
    'settings.modelsEnabled': '模型',
    'settings.addModel': '添加模型',
    'settings.addModelPlaceholder': '输入模型 ID',
    'settings.recommendedModels': '推荐模型（点击添加）',
    'settings.unnamedProvider': '未命名 Provider',
    'settings.emptyProvidersTitle': '还没有任何 Provider',
    'settings.emptyProvidersHint': '点击下方按钮新增一个自定义 Provider，再填写 API Key、Base URL 和模型列表。',
    'settings.agentRouting': 'Agent 模型路由',
    'settings.modelFieldLabel': '模型',
    'settings.invalidRoute': '未就绪',
    'settings.noModelsAvailable': '当前供应商没有可用模型',
    'settings.noConfiguredProviders': '先到模型页新增并保存一个可用 Provider',
    'settings.selectProviderPlaceholder': '选择供应商',
    'settings.selectProviderFirst': '先选择供应商',
    'settings.routeReasonNoProvider': '未选择供应商',
    'settings.routeReasonProviderUnavailable': '所选供应商不可用',
    'settings.routeReasonNoModels': '当前供应商没有可用模型',
    'settings.routeReasonModelInvalid': '所选模型已失效',
    'settings.saveAgentRouting': '保存 Agent 配置',
    'settings.delete': '删除',
    'settings.discard': '放弃更改',
    'settings.noSelection': '请选择或新增一条配置。',
    'control.taskMonitor': '任务监控',
    'control.captureControl': 'Capture 控制',
    'control.contextInfo': 'Context 信息',
    'control.projectInputs': 'Project Inputs',
  },
  en: {
    'app.connected': 'Connected',
    'app.degraded': 'Degraded',
    'app.offline': 'Offline',
    'app.inputPlaceholder': 'Describe a task, invoke skills and tools',
    'app.notice.filesReceived': 'Received {count} files. Confirm them in the Debugger page.',
    'app.notice.newWorkspace': 'Created a new debug workspace.',
    'mode.debugger': 'Debugger',
    'mode.analyzer': 'Analyzer',
    'mode.optimizer': 'Optimizer',
    'sidebar.newTask': 'New Task',
    'sidebar.sessionHistory': 'Session History',
    'sidebar.history': 'History',
    'sidebar.refresh': 'Refresh',
    'sidebar.noRuns': 'No runs yet',
    'sidebar.noRunsHint': 'Completed debug sessions will appear here.',
    'sidebar.projects': 'Projects',
    'sidebar.addProject': 'Add Project',
    'sidebar.removeProject': 'Remove Project',
    'sidebar.noProjects': 'No projects yet',
    'sidebar.noProjectsHint': 'Add a local project directory to begin.',
    'sidebar.sessions': 'Threads',
    'sidebar.addSession': 'New Session',
    'sidebar.noSessions': 'No sessions yet',
    'sidebar.noSessionsHint': 'Create one or start a debug run to generate it.',
    'sidebar.projectRequired': 'Add and select a project first',
    'sidebar.userName': 'RDC Operator',
    'sidebar.userSubtitle': 'Desktop config',
    'sidebar.userSettings': 'User settings',
    'userMenu.language': 'Language',
    'userMenu.theme': 'Theme',
    'userMenu.fontScale': 'Font Size',
    'userMenu.settings': 'Settings Center',
    'theme.dark': 'Dark',
    'theme.light': 'Light',
    'theme.system': 'System',
    'font.small': 'Small',
    'font.medium': 'Medium',
    'font.large': 'Large',
    'settings.title': 'Settings',
    'settings.account': 'Account',
    'settings.general': 'General',
    'settings.workspace': 'Workspace',
    'settings.models': 'Models',
    'settings.agents': 'Agents',
    'settings.accountTitle': 'Account',
    'settings.accountSubtitle': 'Manage local profile information.',
    'settings.avatar': 'Avatar',
    'settings.avatarHint': 'Upload a local avatar image. A square image works best.',
    'settings.uploadAvatar': 'Upload Avatar',
    'settings.nickname': 'Nickname',
    'settings.save': 'Save',
    'settings.generalTitle': 'General',
    'settings.generalSubtitle': 'Configure theme, language, and interface sizing.',
    'settings.workspaceTitle': 'Workspace',
    'settings.workspaceSubtitle': 'Set the single workspace root and review all derived runtime paths.',
    'settings.workspaceRoot': 'Workspace Root',
    'settings.workspaceRootHint': 'Runtime data, settings.json, and logs are all derived from this directory.',
    'settings.chooseDirectory': 'Choose Directory',
    'settings.resetWorkspace': 'Reset Default',
    'settings.settingsFile': 'settings.json',
    'settings.logFile': 'Log File',
    'settings.projectsPath': 'Projects',
    'settings.knowledgePath': 'Knowledge',
    'settings.reveal': 'Reveal',
    'settings.copy': 'Copy Path',
    'settings.modelsTitle': 'Models',
    'settings.modelsSubtitle': 'Manage LLM providers and enabled models.',
    'settings.modelSettings': 'Provider Setup',
    'settings.agentsSubtitle': 'Configure provider/model routing for each agent separately.',
    'settings.agentsHint': 'Each agent chooses a provider first, then a concrete model under that provider.',
    'settings.provider': 'Provider',
    'settings.providerFieldLabel': 'Provider',
    'settings.providerKind': 'Transport Kind',
    'settings.providerConfigured': 'Configured',
    'settings.providerUnconfigured': 'Unconfigured',
    'settings.apiKeyList': 'API Key List',
    'settings.add': 'Add',
    'settings.addProvider': 'Add Provider',
    'settings.unsaved': 'Unsaved',
    'settings.emptyCredentials': 'No credentials for this provider yet. Add one to start.',
    'settings.label': 'Label',
    'settings.apiKey': 'API Key',
    'settings.getApiKey': 'Get API Key',
    'settings.showSecret': 'Show secret',
    'settings.hideSecret': 'Hide secret',
    'settings.baseUrl': 'API Base URL',
    'settings.modelsEnabled': 'Models',
    'settings.addModel': 'Add Model',
    'settings.addModelPlaceholder': 'Enter model id',
    'settings.recommendedModels': 'Recommended Models',
    'settings.unnamedProvider': 'Unnamed Provider',
    'settings.emptyProvidersTitle': 'No providers yet',
    'settings.emptyProvidersHint': 'Create a custom provider first, then fill in its API key, base URL, and model list.',
    'settings.agentRouting': 'Agent Model Routing',
    'settings.modelFieldLabel': 'Model',
    'settings.invalidRoute': 'Invalid',
    'settings.noModelsAvailable': 'No enabled models',
    'settings.noConfiguredProviders': 'Create and save a usable provider in the Models page first',
    'settings.selectProviderPlaceholder': 'Select a provider',
    'settings.selectProviderFirst': 'Select a provider first',
    'settings.routeReasonNoProvider': 'No provider selected',
    'settings.routeReasonProviderUnavailable': 'Selected provider is unavailable',
    'settings.routeReasonNoModels': 'Selected provider has no enabled models',
    'settings.routeReasonModelInvalid': 'Selected model is no longer available',
    'settings.saveAgentRouting': 'Save Agent Routing',
    'settings.delete': 'Delete',
    'settings.discard': 'Discard',
    'settings.noSelection': 'Select an entry or create a new one.',
    'control.taskMonitor': 'Task Monitor',
    'control.captureControl': 'Capture Control',
    'control.contextInfo': 'Context Info',
    'control.projectInputs': 'Project Inputs',
  },
};

export const translate = (
  language: AppLanguage,
  key: TranslationKey,
  params?: Record<string, string | number>,
): string => {
  let text = translations[language][key] ?? key;
  if (!params) return text;
  for (const [param, value] of Object.entries(params)) {
    text = text.replace(`{${param}}`, String(value));
  }
  return text;
};

export const useI18n = () => {
  const language = useAppSettingsStore((state) => state.settings.appearance.language);

  return useMemo(() => ({
    language,
    t: (key: TranslationKey, params?: Record<string, string | number>) => translate(language, key, params),
  }), [language]);
};
