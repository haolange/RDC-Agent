/**
 * Zod schemas for priority IPC channels (settings / workflow / memory).
 */
import { z } from 'zod';
import { REASONING_SELECTIONS, type ReasoningSelection } from '@shared/types/modelCapability';
import { RDC_NO_PROGRESS_TIMEOUT_RANGE_MS } from '@shared/constants/appSettingsDefaults';
import { ipcId, ipcNonEmptyString, ipcString } from './IpcPayloadGuard';

export const MemoryScopeSchema = z.enum(['user', 'project']);

export const MemoryIssueApprovalTokenArgsSchema = z.tuple([
  z.object({
    action: z.enum(['memory.write', 'memory.delete']),
    scope: MemoryScopeSchema,
    name: ipcString(200, 'name').optional(),
    projectRoot: ipcString(1024, 'projectRoot').optional(),
  }),
]);

export const MemoryListArgsSchema = z.tuple([MemoryScopeSchema, ipcString(1024, 'projectRoot').optional()]);

export const MemoryGetArgsSchema = z.tuple([
  MemoryScopeSchema,
  ipcNonEmptyString(200, 'name'),
  ipcString(1024, 'projectRoot').optional(),
]);

export const MemoryWriteArgsSchema = z.tuple([
  z
    .object({
      scope: MemoryScopeSchema,
      projectRoot: ipcString(1024, 'projectRoot').optional(),
      approvalToken: ipcNonEmptyString(128, 'approvalToken'),
      name: ipcNonEmptyString(200, 'name'),
      description: ipcNonEmptyString(2000, 'description'),
      type: z.enum(['user', 'feedback', 'project', 'reference']),
      content: ipcNonEmptyString(200_000, 'content'),
      tags: z.array(ipcString(64, 'tag')).max(32).optional(),
    })
    .strict(),
]);

export const MemoryDeleteArgsSchema = z.tuple([
  MemoryScopeSchema,
  ipcNonEmptyString(200, 'name'),
  ipcNonEmptyString(128, 'approvalToken'),
  ipcString(1024, 'projectRoot').optional(),
]);

const settingsString = (max: number) => z.string().max(max);
const themeChromePatch = z
  .object({
    presetId: z
      .enum(['rdc', 'absolutely', 'ayu', 'catppuccin', 'dracula', 'everforest', 'github', 'gruvbox', 'linear'])
      .optional(),
    accent: settingsString(32).optional(),
    surface: settingsString(32).optional(),
    ink: settingsString(32).optional(),
    contrast: z.number().min(0).max(100).optional(),
    fonts: z
      .object({
        ui: settingsString(200).nullable().optional(),
        code: settingsString(200).nullable().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
const reasoningSelection = z.enum(REASONING_SELECTIONS as [ReasoningSelection, ...ReasoningSelection[]]);
const agentModelId = z
  .string()
  .max(400)
  .regex(/^[^:\s]+:[^\s]+$/u);
const agentProfileId = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/u);

const appearancePatch = z
  .object({
    theme: z.enum(['dark', 'light', 'system']).optional(),
    language: z.enum(['zh-CN', 'en']).optional(),
    fontScale: z.enum(['small', 'medium', 'large']).optional(),
    composerMarkdown: z.boolean().optional(),
    contextBreakdownExpanded: z.boolean().optional(),
    workProcessExpansion: z.enum(['latest', 'all']).optional(),
    chromeThemes: z
      .object({
        light: themeChromePatch.optional(),
        dark: themeChromePatch.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const sidebarPatch = z
  .object({ collapsed: z.boolean().optional(), width: z.number().optional(), expandedWidth: z.number().optional() })
  .strict();
const layoutPatch = z
  .object({
    leftSidebar: sidebarPatch.optional(),
    rightPanel: sidebarPatch.optional(),
    terminal: z.object({ height: z.number().optional() }).strict().optional(),
    window: z
      .object({
        width: z.number().optional(),
        height: z.number().optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        isMaximized: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const profilePatch = z
  .object({
    nickname: settingsString(200).optional(),
    avatarPath: settingsString(4096).optional(),
  })
  .strict();

const toolingPatch = z
  .object({
    rdcCli: z
      .object({
        enabled: z.boolean().optional(),
        command: settingsString(4096).optional(),
        argsPrefix: z.array(settingsString(1024)).max(64).optional(),
        workingDirectory: settingsString(4096).optional(),
        env: z.record(settingsString(200), settingsString(4096)).optional(),
        noProgressTimeoutMs: z
          .number()
          .int()
          .min(RDC_NO_PROGRESS_TIMEOUT_RANGE_MS.min)
          .max(RDC_NO_PROGRESS_TIMEOUT_RANGE_MS.max)
          .optional(),
      })
      .strict()
      .optional(),
    codeInterpreter: z
      .object({
        enabled: z.boolean().optional(),
        command: settingsString(4096).optional(),
        argsPrefix: z.array(settingsString(1024)).max(64).optional(),
        timeoutMs: z.number().int().positive().max(3_600_000).optional(),
        env: z.record(settingsString(200), settingsString(4096)).optional(),
        artifactsEnabled: z.boolean().optional(),
      })
      .strict()
      .optional(),
    shell: z
      .object({ executable: settingsString(4096).optional() })
      .strict()
      .optional(),
  })
  .strict();

const agentRuntimePatch = z
  .object({
    permissions: z
      .object({
        mode: z.enum(['default', 'auto-review', 'full-access', 'custom']).optional(),
        readableRoots: z.array(settingsString(4096)).max(64).optional(),
        writableRoots: z.array(settingsString(4096)).max(64).optional(),
        allowedCommandPrefixes: z.array(settingsString(512)).max(128).optional(),
        deniedCommandPrefixes: z.array(settingsString(512)).max(128).optional(),
      })
      .strict()
      .optional(),
    context: z
      .object({
        compactionThresholdPercent: z.number().min(1).max(100).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const agentModelFieldValue = <T extends z.ZodRawShape>(shape: T) =>
  z.discriminatedUnion('field', [
    z.object({ ...shape, field: z.literal('model'), value: agentModelId }).strict(),
    z.object({ ...shape, field: z.literal('reasoningLevel'), value: reasoningSelection }).strict(),
  ]);

/** One `settings:patch` op; provider state is not part of a patch (it changes through the provider commands). */
const SettingsPatchOpSchema = z.union([
  z.object({ op: z.literal('appearance'), value: appearancePatch }).strict(),
  z.object({ op: z.literal('layout'), value: layoutPatch }).strict(),
  z.object({ op: z.literal('profile'), value: profilePatch }).strict(),
  z.object({ op: z.literal('tooling'), value: toolingPatch }).strict(),
  z.object({ op: z.literal('agentRuntime'), value: agentRuntimePatch }).strict(),
  z.object({ op: z.literal('globalInstructions'), value: settingsString(200_000) }).strict(),
  z.discriminatedUnion('field', [
    z
      .object({ op: z.literal('agentModels.setDefault'), field: z.literal('model'), value: agentModelId.nullable() })
      .strict(),
    z
      .object({
        op: z.literal('agentModels.setDefault'),
        field: z.literal('reasoningLevel'),
        value: reasoningSelection.nullable(),
      })
      .strict(),
  ]),
  agentModelFieldValue({ op: z.literal('agentModels.setAgentField'), agentId: agentProfileId }),
  z
    .object({
      op: z.literal('agentModels.clearAgentField'),
      agentId: agentProfileId,
      field: z.enum(['model', 'reasoningLevel']),
    })
    .strict(),
]);

export const SettingsPatchArgsSchema = z.tuple([z.array(SettingsPatchOpSchema).min(1).max(64)]);

export const SettingsAgentIdArgsSchema = z.tuple([ipcNonEmptyString(200, 'agentId')]);

export const SettingsProviderIdArgsSchema = z.tuple([ipcNonEmptyString(200, 'providerId')]);

export const SettingsHasProviderSecretArgsSchema = z.tuple([ipcNonEmptyString(200, 'providerId')]);

export const SettingsGetEffectiveCatalogArgsSchema = z.tuple([
  ipcNonEmptyString(200, 'providerId'),
  // Electron / browser bridge structured-clone turns omitted optional args into null.
  ipcString(200, 'accountId').nullish(),
]);

export const SettingsImportAgentManifestArgsSchema = z.tuple([ipcNonEmptyString(4096, 'filePath')]);

export const SettingsGetResolvedShellArgsSchema = z.tuple([ipcString(4096, 'executable')]);

export const RuntimeLogListArgsSchema = z.tuple([
  z
    .object({
      scope: z.enum(['app', 'session']),
      sessionId: z.union([ipcId(128, 'sessionId'), z.null()]).optional(),
    })
    .strict(),
]);

export const WorkflowResumeArgsSchema = z.tuple([ipcId(128, 'sessionId').optional()]);

export const WorkflowStopArgsSchema = z.tuple([ipcId(128, 'runId').optional()]);

export const WorkflowGetRunUsageArgsSchema = z.tuple([
  z
    .object({
      sessionId: ipcId(128, 'sessionId'),
      runId: ipcId(128, 'runId').optional(),
    })
    .strict(),
]);
