import type { ElectronAPI } from './electron';

export type PlatformApi = Pick<ElectronAPI, 'platform' | 'isMac' | 'isWindows' | 'isLinux'>;
export type AppMetaApi = ElectronAPI['appMeta'];
export type AppShellApi = ElectronAPI['appShell'];
export type ConversationApi = ElectronAPI['conversation'];
export type WorkflowApi = ElectronAPI['workflow'];
export type AgentApi = ElectronAPI['agent'];
export type ToolApi = ElectronAPI['tool'];
export type EvidenceApi = ElectronAPI['evidence'];
export type LlmApi = ElectronAPI['llm'];
export type SettingsApi = ElectronAPI['settings'];
export type ProjectApi = ElectronAPI['project'];
export type DeviceApi = ElectronAPI['device'];
export type SessionApi = ElectronAPI['session'];
export type RunApi = ElectronAPI['run'];
export type RuntimeLogApi = ElectronAPI['runtimeLog'];
export type TerminalApi = ElectronAPI['terminal'];
export type CaptureApi = ElectronAPI['capture'];
export type ContextApi = ElectronAPI['context'];
export type EventSubscriptionApi = ElectronAPI['events'];
export type WindowControlsApi = ElectronAPI['windowControls'];
export type DialogApi = Pick<ElectronAPI, 'selectFiles' | 'selectRdcFiles' | 'selectDirectory'>;
export type RawChannelSubscriptionApi = Pick<ElectronAPI, 'on' | 'off'>;

export type RendererElectronApi = ElectronAPI;
