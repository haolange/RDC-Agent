/**
 * ZodConfigValidator — 基于 Zod Schema 的类型安全配置验证。
 */
import { z } from 'zod';

const UiPreferencesSchema = z.object({
  theme: z.enum(['dark', 'light', 'system']).optional().default('dark'),
  language: z.string().optional().default('en'),
  fontScale: z.enum(['small', 'medium', 'large']).optional().default('medium'),
  composerMarkdown: z.boolean().optional().default(false),
  usePointerCursors: z.boolean().optional().default(false),
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
