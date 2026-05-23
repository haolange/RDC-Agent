export const COPILOT_EDITOR_HEADERS = {
  'Editor-Version': 'vscode/1.107.0',
  'Editor-Plugin-Version': 'copilot-chat/0.35.0',
} as const;

export const COPILOT_WIRE_HEADERS = {
  ...COPILOT_EDITOR_HEADERS,
  'Copilot-Integration-Id': 'vscode-chat',
} as const;
