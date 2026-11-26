import { describe, expect, it } from 'vitest';
import { redactCredentialLikeText, redactedArgumentsPreview, redactSecretsDeep } from './secretRedaction';

// Assembled at runtime so the repository never contains a token-shaped literal.
const repeat = (unit: string, count: number) => unit.repeat(count);
const githubClassic = `ghp_${repeat('A1b2', 9)}`;
const githubFineGrained = `github_pat_${repeat('Z9_y', 12)}`;
const awsKeyId = `AKIA${repeat('Q7', 8)}`;
const slackBot = `xoxb-${repeat('12ab', 6)}`;

describe('secret redaction', () => {
  it.each([
    ['a classic GitHub token', `push with ${githubClassic} please`],
    ['a fine-grained GitHub token', `token is ${githubFineGrained}`],
    ['an AWS access key id', `aws configure set ${awsKeyId}`],
    ['a Slack bot token', `SLACK=${slackBot}`],
    ['a session token assignment', 'session_token = abcdefgh12345678'],
    ['a PEM private key', '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk\n-----END OPENSSH PRIVATE KEY-----'],
  ])('removes %s from text', (_label, text) => {
    const redacted = redactCredentialLikeText(text);
    expect(redacted).toContain('[REDACTED');
    for (const secret of [
      githubClassic,
      githubFineGrained,
      awsKeyId,
      slackBot,
      'abcdefgh12345678',
      'b3BlbnNzaC1rZXk',
    ]) {
      expect(redacted).not.toContain(secret);
    }
  });

  it('redacts token-named fields without touching token counts', () => {
    const { value } = redactSecretsDeep({
      token: 'opaque',
      githubToken: 'opaque',
      usage: { inputTokens: 12, maxTokens: 400 },
    });
    expect(value).toEqual({
      token: '[REDACTED]',
      githubToken: '[REDACTED]',
      usage: { inputTokens: 12, maxTokens: 400 },
    });
  });

  it('previews any tool arguments through the same redaction', () => {
    const preview = redactedArgumentsPreview({
      command: `git push https://${githubClassic}@example.com/repo.git`,
      headers: { Authorization: 'Bearer abc' },
    });
    expect(preview).not.toContain(githubClassic);
    expect(preview).toContain('"Authorization":"[REDACTED]"');
    expect(redactedArgumentsPreview(undefined)).toBe('{}');
  });
});
