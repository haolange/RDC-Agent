export function resolveHookTrustProjectRoot(input: {
  scope: 'builtin' | 'user' | 'project';
  projectRoot?: string | null;
}): string | null {
  if (input.scope !== 'project') return null;
  return input.projectRoot ?? null;
}
