export const PRELOAD_EVENT_CHANNELS = [
  'file:open',
  'case:new',
  'settings:open',
  'app:themeChanged',
  'workflow:stateChanged',
  'workflow:stageChanged',
  'workflow:runStatusChanged',
  'workflow:runUsageChanged',
  'workflow:blocked',
  'agent:message',
  'agent:statusChanged',
  'tool:executionComplete',
  'evidence:eventAdded',
  'llm:stream',
  'window:maximized-changed',
  'device:statusChanged',
  'capture:statusChanged',
  'context:changed',
  'project:inputsChanged',
  'capture:openedStateChanged',
  'runtime:logAppended',
  'terminal:data',
  'terminal:exit',
  'terminal:tabsChanged',
  'conversation:event',
] as const;

export type PreloadEventChannel = (typeof PRELOAD_EVENT_CHANNELS)[number];

export const isPreloadEventChannel = (channel: string): channel is PreloadEventChannel => {
  return PRELOAD_EVENT_CHANNELS.includes(channel as PreloadEventChannel);
};
