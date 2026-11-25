import { describe, expect, it } from 'vitest';
import { hasKnowledgeSecret } from './knowledgeSensitiveText';

describe('knowledge secret detection', () => {
  it('recognises credentials by the shape of their value', () => {
    for (const text of [
      'OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuv123',
      'token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef0123',
      'AWS key AKIAABCDEFGHIJKLMNOP in the log',
      '-----BEGIN RSA PRIVATE KEY-----',
      'Authorization: Bearer abcdefghijklmnopqrstuvwxyz',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
      'postgres://admin:hunter22@db.internal/app',
      'client_secret: 9f8e7d6c5b4a',
      'password: hunter2',
    ]) {
      expect(hasKnowledgeSecret(text), text).toBe(true);
    }
  });

  it('leaves prose that only names a credential', () => {
    for (const text of [
      'Rotate the password after the incident.',
      'The api_key field was missing from the request.',
      'Secrets are stored through safeStorage.',
      'Bearer tokens expire after an hour.',
    ]) {
      expect(hasKnowledgeSecret(text), text).toBe(false);
    }
  });
});
