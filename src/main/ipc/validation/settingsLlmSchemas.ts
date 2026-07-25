import { z } from 'zod';
import { ipcNonEmptyString, ipcString } from './IpcPayloadGuard';

const LlmProviderAuthModeSchema = z.enum(['none', 'api-key', 'local', 'account', 'environment']);

export const LlmProviderDraftArgsSchema = z.tuple([
  z.object({
    providerId: ipcNonEmptyString(200, 'providerId'),
    authMode: LlmProviderAuthModeSchema.optional(),
    apiKey: ipcString(16_000, 'apiKey').optional(),
    baseUrl: ipcString(2048, 'baseUrl').optional(),
    protocol: ipcString(64, 'protocol').optional(),
    connectionValues: z.record(z.string().max(200), ipcString(16_000, 'connectionValue')).optional(),
    modelPreferences: z.array(z.record(z.string().max(200), z.unknown())).max(512).optional(),
  }).strict(),
]);

export const LlmModelCapabilityProbeArgsSchema = z.tuple([
  z.object({
    providerId: ipcNonEmptyString(200, 'providerId'),
    modelId: ipcNonEmptyString(200, 'modelId'),
    mode: z.enum(['default', 'one-million-context', 'fast']),
  }).strict(),
]);

export const LlmProviderIdArgsSchema = z.tuple([
  ipcNonEmptyString(200, 'providerId'),
]);

export const LlmProviderAccountLoginStartArgsSchema = z.tuple([
  z.object({
    providerId: ipcNonEmptyString(200, 'providerId'),
    authMode: LlmProviderAuthModeSchema.optional(),
    accountLoginMode: z.enum(['browser', 'device']).optional(),
  }).strict(),
]);

export const LlmProviderAccountLoginFinishArgsSchema = z.tuple([
  z.object({
    providerId: ipcNonEmptyString(200, 'providerId'),
    code: ipcString(8_000, 'code').optional(),
    state: ipcString(8_000, 'state').optional(),
    flowId: ipcString(200, 'flowId').optional(),
  }).strict(),
]);

export const SettingsSaveAgentDefinitionArgsSchema = z.tuple([
  z.object({
    draft: z.record(z.string().max(200), z.unknown()),
    clientRevision: z.number().int().nonnegative().max(1_000_000_000),
  }).strict(),
]);

export const SettingsSaveProviderDefinitionArgsSchema = z.tuple([
  z.object({
    provider: z.record(z.string().max(200), z.unknown()),
    clientRevision: z.number().int().nonnegative().max(1_000_000_000),
  }).strict(),
]);
