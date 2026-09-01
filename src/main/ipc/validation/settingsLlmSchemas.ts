import { z } from 'zod';
import { ipcNonEmptyString, ipcString } from './IpcPayloadGuard';
import { ModelsOverrideSchema } from '@shared/provider-catalog/modelsOverrideSchema';

const LlmProviderAuthModeSchema = z.enum(['none', 'api-key', 'local', 'account', 'environment']);

/** Matches renderer `Date.now() * 1000` revision clocks (safe-integer domain). */
const ClientRevisionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const LlmProviderDraftArgsSchema = z.tuple([
  z.object({
    providerId: ipcNonEmptyString(200, 'providerId'),
    authMode: LlmProviderAuthModeSchema.optional(),
    apiKey: ipcString(16_000, 'apiKey').optional(),
    baseUrl: ipcString(2048, 'baseUrl').optional(),
    protocol: ipcString(64, 'protocol').optional(),
    connectionValues: z.record(z.string().max(200), ipcString(16_000, 'connectionValue')).optional(),
    // Large catalogs (OpenRouter etc.) routinely exceed 512; keep a hard cap for IPC DoS only.
    modelPreferences: z.array(z.record(z.string().max(200), z.unknown())).max(10_000).optional(),
  }).strict(),
]);

export const LlmModelCapabilityProbeArgsSchema = z.tuple([
  z.object({
    providerId: ipcNonEmptyString(200, 'providerId'),
    modelId: ipcNonEmptyString(200, 'modelId'),
    mode: z.enum(['default', 'max-context', 'fast']),
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

const projectScopeIdRefine = (
  value: { scope: 'user' | 'project'; projectId?: string },
  ctx: z.RefinementCtx,
): void => {
  if (value.scope !== 'project') return;
  if (!value.projectId?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'project scope requires a registered projectId.',
      path: ['projectId'],
    });
    return;
  }
  if (/[\\/]|^[A-Za-z]:|\.\./.test(value.projectId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'projectId is a registry id, not a filesystem path.',
      path: ['projectId'],
    });
  }
};

export const SettingsGetAgentDefinitionCommitArgsSchema = z.tuple([
  z.object({
    agentId: z.string().min(1).max(200),
    scope: z.enum(['user', 'project']),
    projectId: z.string().max(200).optional(),
  }).strict().superRefine(projectScopeIdRefine),
]);

export const SettingsSaveAgentDefinitionArgsSchema = z.tuple([
  z.object({
    draft: z.record(z.string().max(200), z.unknown()),
    clientRevision: ClientRevisionSchema,
    scope: z.enum(['user', 'project']),
    projectId: z.string().max(200).optional(),
    sourceHash: z.string().max(128).optional(),
  }).strict().superRefine(projectScopeIdRefine),
]);

export const SettingsSaveProviderDefinitionArgsSchema = z.tuple([
  z.object({
    provider: z.record(z.string().max(200), z.unknown()),
    clientRevision: ClientRevisionSchema,
  }).strict(),
]);

export const SettingsGetModelsOverrideArgsSchema = z.tuple([]);

export const SettingsSetModelsOverrideArgsSchema = z.tuple([
  ModelsOverrideSchema,
]);
