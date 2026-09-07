export function buildComposerSessionScopeKey(
  projectId: string | null | undefined,
  sessionId: string | null | undefined,
): string {
  if (!projectId) return 'no-project';
  return [projectId, sessionId ?? 'no-session'].join(':');
}