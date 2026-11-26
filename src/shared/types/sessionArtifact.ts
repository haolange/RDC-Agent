/**
 * The `session://` scheme the renderer recognizes. Grammar, categories, quotas and parsing are main's:
 * src/main/sessions/artifacts/sessionArtifactContract.ts.
 */

export const SESSION_ARTIFACT_SCHEME = 'session://';

export function isSessionArtifactUri(value: string): boolean {
  return value.startsWith(SESSION_ARTIFACT_SCHEME);
}
