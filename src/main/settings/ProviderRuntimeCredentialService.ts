import { randomUUID } from 'node:crypto';
import type { LLMProviderConfig } from '@shared/types/llm';
import type { LlmProviderId } from '@shared/types/settings';
import { settingsService } from './SettingsService';
import { resolveProviderConnectionHeaders } from './ProviderConnectionSchema';
import { resolveGoogleVertexAccessToken } from './GoogleApplicationCredentials';
import {
  hasAwsBedrockBearerToken,
  resolveAwsBedrockCredentials,
  type AwsBedrockCredentials,
} from './AwsBedrockCredentials';

export type ProviderRuntimeCredentialOperation = 'chat' | 'embed';

export interface FrozenProviderRuntimeCredential {
  handle: string;
  providerId: LlmProviderId;
  operation: ProviderRuntimeCredentialOperation;
  provider: LLMProviderConfig;
  connectionValues: Readonly<Record<string, string>>;
  connectionHeaders: Readonly<Record<string, string>>;
  awsBedrockCredentials?: AwsBedrockCredentials;
  createdAt: number;
}

interface ProviderRuntimeCredentialDependencies {
  getProvider(providerId: LlmProviderId): LLMProviderConfig | undefined;
  getConnectionValues(providerId: LlmProviderId): Record<string, string>;
  getConnectionHeaders(providerId: LlmProviderId, values: Readonly<Record<string, string>>): Record<string, string>;
  resolveGoogleVertex(path: string | undefined): Promise<string>;
  resolveAwsBedrock(values: Readonly<Record<string, string>>): Promise<AwsBedrockCredentials>;
  now(): number;
  createHandle(): string;
}

const MAX_LEASE_AGE_MS = 24 * 60 * 60 * 1000;

const defaultDependencies: ProviderRuntimeCredentialDependencies = {
  getProvider: (providerId) => settingsService.getLlmConfig().providers.find((entry) => entry.id === providerId),
  getConnectionValues: (providerId) => settingsService.getProviderConnectionValues(providerId),
  getConnectionHeaders: (providerId, values) => {
    const provider = settingsService.getAll().llm.providers.find((entry) => entry.id === providerId);
    return resolveProviderConnectionHeaders(provider?.connectionSchema, values);
  },
  resolveGoogleVertex: resolveGoogleVertexAccessToken,
  resolveAwsBedrock: resolveAwsBedrockCredentials,
  now: Date.now,
  createHandle: randomUUID,
};

export class ProviderRuntimeCredentialService {
  private readonly leases = new Map<string, FrozenProviderRuntimeCredential>();

  constructor(
    private readonly dependencies: ProviderRuntimeCredentialDependencies = defaultDependencies,
  ) {}

  async freeze(
    providerId: LlmProviderId,
    operation: ProviderRuntimeCredentialOperation = 'chat',
  ): Promise<string> {
    this.purgeExpired();
    const handle = this.dependencies.createHandle();
    this.leases.set(handle, await this.materializeLease(providerId, handle, operation));
    return handle;
  }

  async refresh(handle: string, providerId: LlmProviderId): Promise<void> {
    this.purgeExpired();
    const current = this.leases.get(handle);
    if (!current || current.providerId !== providerId) {
      throw new Error(`Runtime credential handle is invalid for ${providerId}.`);
    }
    const refreshed = await this.materializeLease(providerId, handle, current.operation);
    this.leases.set(handle, {
      ...refreshed,
      provider: Object.freeze({
        ...current.provider,
        apiKey: refreshed.provider.apiKey,
        accountId: refreshed.provider.accountId,
      }),
    });
  }

  private async materializeLease(
    providerId: LlmProviderId,
    handle: string,
    operation: ProviderRuntimeCredentialOperation,
  ): Promise<FrozenProviderRuntimeCredential> {
    const configured = this.dependencies.getProvider(providerId);
    if (!configured) {
      throw new Error(`No verified runtime credentials are available for ${providerId}.`);
    }
    const connectionValues = { ...this.dependencies.getConnectionValues(providerId) };
    const connectionHeaders = { ...this.dependencies.getConnectionHeaders(providerId, connectionValues) };
    let apiKey = configured.apiKey;
    let awsBedrockCredentials: AwsBedrockCredentials | undefined;
    if ((providerId === 'google-vertex' || providerId === 'google-vertex-anthropic') && !apiKey) {
      apiKey = await this.dependencies.resolveGoogleVertex(connectionValues.GOOGLE_APPLICATION_CREDENTIALS);
    }
    if (providerId === 'amazon-bedrock' && !apiKey && !hasAwsBedrockBearerToken(connectionValues)) {
      awsBedrockCredentials = await this.dependencies.resolveAwsBedrock(connectionValues);
    }
    const createdAt = this.dependencies.now();
    return {
      handle,
      providerId,
      operation,
      provider: Object.freeze({ ...configured, apiKey }),
      connectionValues: Object.freeze(connectionValues),
      connectionHeaders: Object.freeze(connectionHeaders),
      ...(awsBedrockCredentials ? { awsBedrockCredentials: Object.freeze({ ...awsBedrockCredentials }) } : {}),
      createdAt,
    };
  }

  get(
    handle: string | undefined,
    providerId: LlmProviderId,
    expectedOperation: ProviderRuntimeCredentialOperation,
  ): FrozenProviderRuntimeCredential | null {
    if (!handle) return null;
    const lease = this.leases.get(handle);
    if (!lease || lease.providerId !== providerId) {
      throw new Error(`Runtime credential handle is invalid for ${providerId}.`);
    }
    if (lease.operation !== expectedOperation) {
      throw new Error(`Runtime credential handle is not issued for ${expectedOperation}.`);
    }
    return lease;
  }

  release(handle: string | undefined): void {
    if (handle) this.leases.delete(handle);
  }

  private purgeExpired(): void {
    const cutoff = this.dependencies.now() - MAX_LEASE_AGE_MS;
    for (const [handle, lease] of this.leases) {
      if (lease.createdAt < cutoff) this.leases.delete(handle);
    }
  }
}

export const providerRuntimeCredentialService = new ProviderRuntimeCredentialService();
