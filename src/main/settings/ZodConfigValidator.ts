/**
 * ZodConfigValidator — 基于 Zod Schema 的类型安全配置验证。
 */
import { z } from 'zod';

const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const ThemePresetIdSchema = z.enum([
  'rdc',
  'absolutely',
  'ayu',
  'catppuccin',
  'dracula',
  'everforest',
  'github',
  'gruvbox',
  'linear',
]);

const ThemeChromeSchema = z.object({
  presetId: ThemePresetIdSchema,
  accent: HexColorSchema,
  surface: HexColorSchema,
  ink: HexColorSchema,
  contrast: z.number().min(0).max(100),
  fonts: z.object({
    ui: z.string().nullable(),
    code: z.string().nullable(),
  }),
}).passthrough();

const UiPreferencesSchema = z.object({
  theme: z.enum(['dark', 'light', 'system']).optional().default('dark'),
  language: z.enum(['zh-CN', 'en']).optional().default('zh-CN'),
  fontScale: z.enum(['small', 'medium', 'large']).optional().default('medium'),
  composerMarkdown: z.boolean().optional().default(false),
  usePointerCursors: z.boolean().optional().default(false),
  contextBreakdownExpanded: z.boolean().optional().default(false),
  reduceMotion: z.enum(['system', 'on', 'off']).optional().default('system'),
  chromeThemes: z.object({
    light: ThemeChromeSchema,
    dark: ThemeChromeSchema,
  }).optional(),
}).passthrough();

const AgentPermissionSchema = z.object({
  mode: z.enum(['default', 'auto-review', 'full-access', 'custom']).optional().default('default'),
  readableRoots: z.array(z.string()).optional().default([]),
  writableRoots: z.array(z.string()).optional().default([]),
  allowedCommandPrefixes: z.array(z.string()).optional().default([]),
  deniedCommandPrefixes: z.array(z.string()).optional().default([]),
}).passthrough();

export const AppSettingsSchema = z.object({
  appearance: UiPreferencesSchema.optional(),
  agentRuntime: z.object({
    permissions: AgentPermissionSchema.optional(),
  }).passthrough().optional(),
}).passthrough();

export type ValidatedAppSettings = z.infer<typeof AppSettingsSchema>;

export class ZodConfigValidator {
  /** 验证并返回类型安全的配置。 */
  validate(raw: unknown): { success: true; data: ValidatedAppSettings } | { success: false; errors: string[] } {
    const result = AppSettingsSchema.safeParse(raw);
    if (result.success) {
      return { success: true, data: result.data as ValidatedAppSettings };
    }
    return {
      success: false,
      errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    };
  }

  /** 对已有配置进行默认值填充。 */
  withDefaults(raw: unknown): ValidatedAppSettings {
    return AppSettingsSchema.parse(raw ?? {}) as ValidatedAppSettings;
  }
}
