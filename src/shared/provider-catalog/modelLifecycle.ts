/** Codex retired this model for ChatGPT sign-in on 2026-10-14. */
export function isRetiredModel(providerId: string, modelId: string): boolean {
  return providerId === 'chatgpt-account' && modelId.trim().toLowerCase() === 'gpt-5.5';
}
