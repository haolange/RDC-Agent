import { DeploymentApi, type AiDeployment } from '@sap-ai-sdk/ai-api';
import type { HttpDestinationOrFetchOptions } from '@jerome-benoit/sap-ai-provider-v2';

export interface SapAiCoreServiceKey {
  clientId: string;
  clientSecret: string;
  apiUrl: string;
  tokenServiceUrl: string;
}

export function parseSapAiCoreServiceKey(raw: string): SapAiCoreServiceKey {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('AICORE_SERVICE_KEY must be valid JSON.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('AICORE_SERVICE_KEY must be a JSON object.');
  }
  const record = value as Record<string, unknown>;
  const serviceUrls = record.serviceurls;
  const apiUrl = serviceUrls && typeof serviceUrls === 'object' && !Array.isArray(serviceUrls)
    ? readString(serviceUrls as Record<string, unknown>, 'AI_API_URL')
    : '';
  const clientId = readString(record, 'clientid');
  const clientSecret = readString(record, 'clientsecret');
  const authUrl = readString(record, 'url');
  if (!clientId || !clientSecret || !apiUrl || !authUrl) {
    throw new Error('AICORE_SERVICE_KEY must include clientid, clientsecret, url, and serviceurls.AI_API_URL.');
  }
  return {
    clientId,
    clientSecret,
    apiUrl: normalizeHttpsUrl(apiUrl, 'serviceurls.AI_API_URL'),
    tokenServiceUrl: normalizeTokenServiceUrl(authUrl),
  };
}

export function assertSapAiCoreApiUrl(serviceKey: SapAiCoreServiceKey, configuredApiUrl: string): string {
  const configured = normalizeHttpsUrl(configuredApiUrl, 'AICORE_AI_API_URL');
  if (configured !== serviceKey.apiUrl) {
    throw new Error('AICORE_AI_API_URL must match serviceurls.AI_API_URL in AICORE_SERVICE_KEY.');
  }
  return configured;
}

export function createSapAiCoreDestination(serviceKey: SapAiCoreServiceKey): HttpDestinationOrFetchOptions {
  return {
    url: serviceKey.apiUrl,
    type: 'HTTP',
    proxyType: 'Internet',
    authentication: 'OAuth2ClientCredentials',
    clientId: serviceKey.clientId,
    clientSecret: serviceKey.clientSecret,
    tokenServiceUrl: serviceKey.tokenServiceUrl,
  };
}

export function buildSapAiCoreDeploymentListUrl(apiUrl: string): string {
  return `${apiUrl.replace(/\/+$/u, '')}/lm/deployments`;
}

export async function listSapAiCoreDeployments(input: {
  serviceKeyJson: string;
  configuredApiUrl: string;
  resourceGroup?: string;
  scenarioId: 'orchestration' | 'foundation-models';
}): Promise<AiDeployment[]> {
  const key = parseSapAiCoreServiceKey(input.serviceKeyJson);
  assertSapAiCoreApiUrl(key, input.configuredApiUrl);
  const result = await DeploymentApi.deploymentQuery({
    scenarioId: input.scenarioId,
    status: 'RUNNING',
  }, {
    'AI-Resource-Group': input.resourceGroup?.trim() || 'default',
  }).execute(createSapAiCoreDestination(key));
  return result.resources;
}

function readString(record: Record<string, unknown>, key: string): string {
  return typeof record[key] === 'string' ? record[key].trim() : '';
}

function normalizeHttpsUrl(value: string, field: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${field} must be an absolute HTTPS URL.`);
  }
  if (url.protocol !== 'https:' || !url.hostname) {
    throw new Error(`${field} must be an absolute HTTPS URL.`);
  }
  return url.toString().replace(/\/+$/u, '');
}

function normalizeTokenServiceUrl(value: string): string {
  const base = normalizeHttpsUrl(value, 'url');
  return /\/oauth\/token$/u.test(base) ? base : `${base}/oauth/token`;
}
