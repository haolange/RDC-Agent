export const BROWSER_ELECTRON_API_DOMAINS = {
  shell: ['platform', 'appMeta', 'appShell', 'windowControls', 'selectFiles', 'selectRdcFiles', 'selectKnowledgeImport', 'selectDirectory'],
  conversation: ['conversation'],
  workflow: ['workflow'],
  projectSession: ['project', 'session', 'run'],
  captureDevice: ['capture', 'device'],
  settingsProfile: ['settings', 'llm'],
  toolsEvidenceRuntime: ['tool', 'evidence', 'runtimeLog'],
  terminalContext: ['terminal', 'context'],
  agentEvents: ['agent', 'events', 'on', 'off'],
  memory: ['memory'],
  rdcRuntime: ['rdcRuntime'],
} as const;

export type BrowserElectronApiDomain = keyof typeof BROWSER_ELECTRON_API_DOMAINS;
export type BrowserElectronApiDomainMember =
  (typeof BROWSER_ELECTRON_API_DOMAINS)[BrowserElectronApiDomain][number];
