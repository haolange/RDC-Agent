import path from 'path';
import { z } from 'zod';
import { AppError, type AppErrorOptions } from '@shared/errors/appError';
import { REASONING_SELECTIONS, type ReasoningSelection } from '@shared/types/modelCapability';
import { isHexColor } from '@shared/theme/color';
import { THEME_PRESET_IDS } from '@shared/theme/presets';
import { splitCanonicalAgentModelId } from '@shared/utils/agentModelRoute';
import { isSafeAgentProfileId } from '../agent-manifests/agentProfileId';
import type {
  AgentModelSettings,
  AgentRuntimeSettings,
  LayoutPreferences,
  LlmProviderAuthMode,
  ProfileSettings,
  ThemePresetId,
  ToolingSettings,
  UiPreferences,
} from '@shared/types/settings';

/**
 * The settings file (`config.json`) holds only what the user decided or the app observed for that user. Everything
 * the provider catalog knows (names, endpoints, protocols, model lists, capabilities) is composed at read time, so it
 * never goes stale in user data. The file carries no format version. Every level is strict: an unknown field (a file
 * written in another format included) or a wrong type makes the whole file unusable; nothing is converted or repaired.
 */

const text = z.string();
const nonEmpty = z.string().min(1);
const finite = z.number().finite();
const integer = z.number().int();
const stringList = z.array(text);
const stringMap = z.record(text, text);

const AUTH_MODES = [
  'none',
  'api-key',
  'local',
  'account',
  'environment',
] as const satisfies readonly LlmProviderAuthMode[];
const authMode = z.enum(AUTH_MODES);
const reasoningSelection = z.enum(REASONING_SELECTIONS as [ReasoningSelection, ...ReasoningSelection[]]);
const hexColor = text.refine(isHexColor, 'expected a #rrggbb color');

const ThemeChromeSchema = z
  .object({
    presetId: z.enum(THEME_PRESET_IDS as [ThemePresetId, ...ThemePresetId[]]),
    accent: hexColor,
    surface: hexColor,
    ink: hexColor,
    contrast: integer.min(0).max(100),
    fonts: z.object({ ui: text.nullable(), code: text.nullable() }).strict(),
  })
  .strict();

const AppearanceSchema: z.ZodType<UiPreferences> = z
  .object({
    theme: z.enum(['dark', 'light', 'system']),
    language: z.enum(['zh-CN', 'en']),
    fontScale: z.enum(['small', 'medium', 'large']),
    composerMarkdown: z.boolean(),
    contextBreakdownExpanded: z.boolean(),
    workProcessExpansion: z.enum(['latest', 'all']),
    chromeThemes: z.object({ light: ThemeChromeSchema, dark: ThemeChromeSchema }).strict(),
  })
  .strict();

const SidebarSchema = z.object({ collapsed: z.boolean(), width: finite, expandedWidth: finite }).strict();

const LayoutSchema: z.ZodType<LayoutPreferences> = z
  .object({
    leftSidebar: SidebarSchema,
    rightPanel: SidebarSchema,
    terminal: z.object({ height: finite }).strict(),
    window: z.object({ width: integer, height: integer, x: integer, y: integer, isMaximized: z.boolean() }).strict(),
  })
  .strict();

const ProfileSchema: z.ZodType<ProfileSettings> = z
  .object({
    nickname: nonEmpty,
    avatarPath: text.optional(),
  })
  .strict();

const ToolingSchema: z.ZodType<ToolingSettings> = z
  .object({
    rdcCli: z
      .object({
        enabled: z.boolean(),
        command: text,
        argsPrefix: stringList,
        workingDirectory: text,
        env: stringMap,
        timeoutMs: integer.positive(),
      })
      .strict(),
    codeInterpreter: z
      .object({
        enabled: z.boolean(),
        command: text,
        argsPrefix: stringList,
        timeoutMs: integer.positive(),
        env: stringMap,
        artifactsEnabled: z.boolean(),
      })
      .strict(),
    shell: z.object({ executable: text }).strict(),
  })
  .strict();

const AgentRuntimeSchema: z.ZodType<AgentRuntimeSettings> = z
  .object({
    permissions: z
      .object({
        mode: z.enum(['default', 'auto-review', 'full-access', 'custom']),
        readableRoots: stringList,
        writableRoots: stringList,
        allowedCommandPrefixes: stringList,
        deniedCommandPrefixes: stringList,
      })
      .strict(),
    context: z.object({ compactionThresholdPercent: finite }).strict(),
  })
  .strict();

const AgentModelBindingSchema = z
  .object({
    model: text.refine((value) => splitCanonicalAgentModelId(value) !== null, 'expected provider:model').optional(),
    reasoningLevel: reasoningSelection.optional(),
  })
  .strict();

const AgentModelsSchema: z.ZodType<AgentModelSettings> = z
  .object({
    default: AgentModelBindingSchema,
    byAgent: z.record(text.refine(isSafeAgentProfileId, 'expected an Agent id'), AgentModelBindingSchema),
  })
  .strict();

/**
 * One model as the user left it: preferences they chose, plus what discovery observed for their account. The key's
 * presence records that the model was observed (catalog models that are not always listed appear only then).
 * `label` and `aliases` exist only for models the catalog does not describe; catalog models take both from it.
 */
const UserModelStateSchema = z
  .object({
    enabled: z.boolean().optional(),
    defaultReasoningSelection: reasoningSelection.optional(),
    defaultBudgetTokens: integer.positive().optional(),
    preferredRouteOptionId: nonEmpty.optional(),
    availability: z.enum(['available', 'unavailable', 'unknown']).optional(),
    availabilityReason: nonEmpty.optional(),
    label: nonEmpty.optional(),
    aliases: z.array(nonEmpty).min(1).optional(),
  })
  .strict();

/**
 * One provider as the user left it. Credentials are not here: secrets live in the secret store under refs derived from
 * the provider id and `authAccountIds`, and their presence is read from that store when the provider is composed.
 */
const UserProviderStateSchema = z
  .object({
    authMode: authMode.optional(),
    authAccountIds: z.partialRecord(authMode, nonEmpty).optional(),
    configuredAuthMode: authMode.optional(),
    /** The app observed this connection failing (for example an OAuth refresh); it stays until the user reconnects. */
    status: z.literal('failed').optional(),
    lastError: text.optional(),
    lastTestedAt: nonEmpty.optional(),
    lastModelRefreshAt: nonEmpty.optional(),
    connectionValues: stringMap.optional(),
    /** Only for providers whose catalog entry lets the user edit the endpoint. */
    baseUrl: nonEmpty.optional(),
    accountLabel: text.optional(),
    planLabel: text.optional(),
    oauthExpiresAt: nonEmpty.optional(),
    oauthRefreshAvailable: z.boolean().optional(),
    models: z.record(nonEmpty, UserModelStateSchema).optional(),
  })
  .strict();

const SettingsFileSchema = z
  .object({
    appearance: AppearanceSchema,
    layout: LayoutSchema,
    profile: ProfileSchema,
    tooling: ToolingSchema,
    agentRuntime: AgentRuntimeSchema,
    agentModels: AgentModelsSchema,
    providers: z.record(nonEmpty, UserProviderStateSchema),
  })
  .strict();

export type UserModelState = z.infer<typeof UserModelStateSchema>;
export type UserProviderState = z.infer<typeof UserProviderStateSchema>;
export type SettingsFile = z.infer<typeof SettingsFileSchema>;

/**
 * The settings file's parser for `readValidatedSync`. Anything that does not match the strict schema throws, which
 * the storage primitive reports as `STORAGE_CORRUPT` with the file left as it is.
 */
export function parseSettingsFile(value: unknown): SettingsFile {
  const parsed = SettingsFileSchema.safeParse(value);
  if (!parsed.success) throw new TypeError(z.prettifyError(parsed.error));
  return parsed.data;
}

/** A settings document assembled in memory; failing here is a bug in the writer, never written to disk. */
export function assertSettingsFile(file: SettingsFile): SettingsFile {
  return SettingsFileSchema.parse(file);
}

type SettingsFileErrorCode = 'STORAGE_CORRUPT' | 'STORAGE_UNREADABLE';

/** The settings file exists but cannot be used: damaged, invalid (another format included), or unreadable. */
export class SettingsFileError extends AppError {
  declare readonly code: SettingsFileErrorCode;

  constructor(
    code: SettingsFileErrorCode,
    readonly filePath: string,
    options: Pick<AppErrorOptions, 'cause'>,
  ) {
    super(code, `${filePath} cannot be used as the settings file`, {
      ...options,
      params: { file: path.basename(filePath) },
    });
    this.name = 'SettingsFileError';
  }
}
