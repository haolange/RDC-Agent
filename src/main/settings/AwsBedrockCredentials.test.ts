import { describe, expect, it } from 'vitest';
import {
  resolveAwsBedrockCredentials,
  signAwsBedrockRequest,
} from './AwsBedrockCredentials';

describe('AwsBedrockCredentials', () => {
  it('resolves an explicit access-key session without consulting ambient state', async () => {
    await expect(resolveAwsBedrockCredentials({
      AWS_REGION: 'us-east-2',
      AWS_ACCESS_KEY_ID: 'AKIDEXAMPLE',
      AWS_SECRET_ACCESS_KEY: 'secret',
      AWS_SESSION_TOKEN: 'session',
    })).resolves.toEqual({
      region: 'us-east-2',
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'secret',
      sessionToken: 'session',
    });
  });

  it('rejects incomplete explicit credentials before falling through to the chain', async () => {
    await expect(resolveAwsBedrockCredentials({
      AWS_REGION: 'us-east-1',
      AWS_ACCESS_KEY_ID: 'AKIDEXAMPLE',
    })).rejects.toThrow('must be provided together');
  });

  it('signs the exact Bedrock Mantle URL and body with SigV4', async () => {
    const headers = await signAwsBedrockRequest({
      url: 'https://bedrock-mantle.us-east-1.api.aws/openai/v1/responses',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"model":"openai.gpt-5.5"}',
    }, {
      region: 'us-east-1',
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'secret',
      sessionToken: 'session',
    });
    expect(headers.authorization).toMatch(/^AWS4-HMAC-SHA256 /u);
    expect(headers['x-amz-security-token']).toBe('session');
    expect(headers['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/u);
  });
});
