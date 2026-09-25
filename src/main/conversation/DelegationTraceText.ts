import { redactSecretsDeep, redactCredentialLikeText } from '../runtime/secretRedaction';

/** Keep persisted delegation bodies and their visible projection on one redaction path. */
export function safeDelegationText(value: unknown): string {
  const raw = typeof value === 'string' ? value : JSON.stringify(redactSecretsDeep(value).value);
  return redactCredentialLikeText(raw ?? '');
}
