import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { AwsV4Signer } from 'aws4fetch';

export interface AwsBedrockCredentials {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface ProviderRequestAuthorizationInput {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body: string;
}

export type ProviderRequestAuthorizer = (
  input: ProviderRequestAuthorizationInput,
) => Promise<Record<string, string>>;

type ConnectionValues = Readonly<Record<string, string>>;

const providerChainByProfile = new Map<string, ReturnType<typeof fromNodeProviderChain>>();

function requiredRegion(values: ConnectionValues): string {
  const region = values.AWS_REGION?.trim()
    || process.env.AWS_REGION?.trim()
    || process.env.AWS_DEFAULT_REGION?.trim();
  if (!region) {
    throw new Error('AWS_REGION is required for Amazon Bedrock.');
  }
  return region;
}

function explicitCredentials(values: ConnectionValues, region: string): AwsBedrockCredentials | null {
  const accessKeyId = values.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = values.AWS_SECRET_ACCESS_KEY?.trim();
  if (!accessKeyId && !secretAccessKey) return null;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('AWS access key ID and secret access key must be provided together.');
  }
  const sessionToken = values.AWS_SESSION_TOKEN?.trim();
  return {
    region,
    accessKeyId,
    secretAccessKey,
    ...(sessionToken ? { sessionToken } : {}),
  };
}

export async function resolveAwsBedrockCredentials(
  values: ConnectionValues,
): Promise<AwsBedrockCredentials> {
  const region = requiredRegion(values);
  const explicit = explicitCredentials(values, region);
  if (explicit) return explicit;

  const profile = values.AWS_PROFILE?.trim() || process.env.AWS_PROFILE?.trim();
  const cacheKey = profile || '<default-chain>';
  let provider = providerChainByProfile.get(cacheKey);
  if (!provider) {
    provider = fromNodeProviderChain(profile ? { profile } : {});
    providerChainByProfile.set(cacheKey, provider);
  }
  let resolved: Awaited<ReturnType<typeof provider>>;
  try {
    resolved = await provider();
  } catch (error) {
    throw new Error(
      `AWS credential chain is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!resolved.accessKeyId || !resolved.secretAccessKey) {
    throw new Error('AWS credential chain did not return a usable access key pair.');
  }
  return {
    region,
    accessKeyId: resolved.accessKeyId,
    secretAccessKey: resolved.secretAccessKey,
    ...(resolved.sessionToken ? { sessionToken: resolved.sessionToken } : {}),
  };
}

export async function signAwsBedrockRequest(
  input: ProviderRequestAuthorizationInput,
  credentials: AwsBedrockCredentials,
): Promise<Record<string, string>> {
  const signed = await new AwsV4Signer({
    url: input.url,
    method: input.method,
    headers: Object.entries(input.headers),
    body: input.body,
    region: credentials.region,
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    sessionToken: credentials.sessionToken,
    service: 'bedrock',
  }).sign();
  return Object.fromEntries(signed.headers.entries());
}

export function createAwsBedrockRequestAuthorizer(
  values: ConnectionValues,
): ProviderRequestAuthorizer {
  const frozenValues = { ...values };
  return async (input) => signAwsBedrockRequest(
    input,
    await resolveAwsBedrockCredentials(frozenValues),
  );
}

export function createAwsBedrockRequestAuthorizerFromCredentials(
  credentials: AwsBedrockCredentials,
): ProviderRequestAuthorizer {
  const frozenCredentials = { ...credentials };
  return (input) => signAwsBedrockRequest(input, frozenCredentials);
}

export function hasAwsBedrockBearerToken(values: ConnectionValues): boolean {
  return Boolean(values.AWS_BEARER_TOKEN_BEDROCK?.trim());
}
