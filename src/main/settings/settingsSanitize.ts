import path from 'path';
import {
  DEFAULT_CONTEXT_COMPACTION_PERCENT,
} from '@shared/types/modelCapability';
import { sanitizeCompactionThresholdPercent } from '@shared/utils/contextBudget';
import type {
  AgentPermissionSettings,
  AgentRuntimeContextSettings,
  AgentRuntimeSettings,
  LayoutPreferences,
  RdxActionId,
  RdxActionSettingsMap,
  RdxCliInvokerSettings,
  RdxShellActionSettings,
  AgentShellSettings,
  CodeInterpreterSettings,
  SidebarLayoutPreference,
  ToolingSettings,
  WindowLayoutPreference,
} from '@shared/types/settings';
import {
  APP_DEFAULT_WINDOW_HEIGHT,
  APP_DEFAULT_WINDOW_WIDTH,
  APP_MIN_WINDOW_HEIGHT,
  APP_MIN_WINDOW_WIDTH,
  TERMINAL_MAX_HEIGHT,
  TERMINAL_MIN_HEIGHT,
} from '@shared/constants/layout';
import {
  DEFAULT_AGENT_RUNTIME,
  DEFAULT_LAYOUT,
  DEFAULT_CODE_INTERPRETER,
  DEFAULT_RDX_ACTIONS,
  DEFAULT_RDX_CLI_INVOKER,
  DEFAULT_SHELL_TOOLING,
  LEFT_DEFAULTS,
  RIGHT_DEFAULTS,
  VALID_PERMISSION_MODES,
  createDefaultRdxAction,
} from './settingsDefaults';

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function pickEnum<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? (value as T) : fallback;
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function sanitizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean)
    : [];
}

export function sanitizeStringRecord(value: unknown): Record<string, string> {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const sanitized: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    const cleanKey = key.trim();
    if (!cleanKey || typeof entry !== 'string') {
      continue;
    }
    sanitized[cleanKey] = entry;
  }
  return sanitized;
}

export function sanitizeRdxCliInvokerSettings(
  value: unknown,
  fallback: RdxCliInvokerSettings = DEFAULT_RDX_CLI_INVOKER,
): RdxCliInvokerSettings {
  const candidate = value && typeof value === 'object' ? value as Partial<RdxCliInvokerSettings> : {};
  const timeoutMs = typeof candidate.timeoutMs === 'number' && Number.isFinite(candidate.timeoutMs)
    ? clamp(Math.trunc(candidate.timeoutMs), 1000, 600000)
    : fallback.timeoutMs;

  return {
    enabled: typeof candidate.enabled === 'boolean' ? candidate.enabled : fallback.enabled,
    command: typeof candidate.command === 'string' ? candidate.command.trim() : fallback.command,
    argsPrefix: sanitizeStringArray(candidate.argsPrefix ?? fallback.argsPrefix),
    workingDirectory: typeof candidate.workingDirectory === 'string' ? candidate.workingDirectory.trim() : fallback.workingDirectory,
    env: sanitizeStringRecord(candidate.env ?? fallback.env),
    timeoutMs,
    catalogPath: typeof candidate.catalogPath === 'string' ? candidate.catalogPath.trim() : fallback.catalogPath,
    jsonMode: pickEnum(candidate.jsonMode, ['auto', 'always'], fallback.jsonMode),
  };
}

export function sanitizeRdxShellActionSettings(
  value: unknown,
  fallback: RdxShellActionSettings = createDefaultRdxAction(),
): RdxShellActionSettings {
  const candidate = value && typeof value === 'object' ? value as Partial<RdxShellActionSettings> : {};
  const timeoutMs = typeof candidate.timeoutMs === 'number' && Number.isFinite(candidate.timeoutMs)
    ? clamp(Math.trunc(candidate.timeoutMs), 1000, 600000)
    : fallback.timeoutMs;
  return {
    enabled: typeof candidate.enabled === 'boolean' ? candidate.enabled : fallback.enabled,
    command: typeof candidate.command === 'string' ? candidate.command.trim() : fallback.command,
    args: sanitizeStringArray(candidate.args ?? fallback.args),
    workingDirectory: typeof candidate.workingDirectory === 'string' ? candidate.workingDirectory.trim() : fallback.workingDirectory,
    env: sanitizeStringRecord(candidate.env ?? fallback.env),
    timeoutMs,
  };
}

export function sanitizeRdxActionsSettings(value: unknown): RdxActionSettingsMap {
  const candidate = value && typeof value === 'object' ? value as Partial<Record<RdxActionId, unknown>> : {};
  return {
    openCapture: sanitizeRdxShellActionSettings(candidate.openCapture, DEFAULT_RDX_ACTIONS.openCapture),
    openRemoteCapture: sanitizeRdxShellActionSettings(
      candidate.openRemoteCapture,
      DEFAULT_RDX_ACTIONS.openRemoteCapture,
    ),
    connectRemote: sanitizeRdxShellActionSettings(candidate.connectRemote, DEFAULT_RDX_ACTIONS.connectRemote),
    closeRuntime: sanitizeRdxShellActionSettings(candidate.closeRuntime, DEFAULT_RDX_ACTIONS.closeRuntime),
    openPreview: sanitizeRdxShellActionSettings(candidate.openPreview, DEFAULT_RDX_ACTIONS.openPreview),
  };
}

export function sanitizeCodeInterpreterSettings(
  value: unknown,
  fallback: CodeInterpreterSettings = DEFAULT_CODE_INTERPRETER,
): CodeInterpreterSettings {
  const candidate = value && typeof value === 'object' ? value as Partial<CodeInterpreterSettings> : {};
  const timeoutMs = typeof candidate.timeoutMs === 'number' && Number.isFinite(candidate.timeoutMs)
    ? clamp(Math.trunc(candidate.timeoutMs), 1000, 600000)
    : fallback.timeoutMs;
  return {
    enabled: typeof candidate.enabled === 'boolean' ? candidate.enabled : fallback.enabled,
    command: typeof candidate.command === 'string' ? candidate.command.trim() : fallback.command,
    argsPrefix: sanitizeStringArray(candidate.argsPrefix ?? fallback.argsPrefix),
    timeoutMs,
    env: sanitizeStringRecord(candidate.env ?? fallback.env),
    artifactsEnabled: typeof candidate.artifactsEnabled === 'boolean'
      ? candidate.artifactsEnabled
      : fallback.artifactsEnabled,
  };
}

export function sanitizeAgentShellSettings(
  value: unknown,
  fallback: AgentShellSettings = DEFAULT_SHELL_TOOLING,
): AgentShellSettings {
  const candidate = value && typeof value === 'object' ? value as Partial<AgentShellSettings> : {};
  return {
    executable: typeof candidate.executable === 'string' ? candidate.executable.trim() : fallback.executable,
  };
}

export function sanitizeToolingSettings(value: unknown): ToolingSettings {
  const candidate = value && typeof value === 'object' ? value as Partial<ToolingSettings> : {};
  return {
    rdxCli: sanitizeRdxCliInvokerSettings(candidate.rdxCli),
    rdxActions: sanitizeRdxActionsSettings(candidate.rdxActions),
    codeInterpreter: sanitizeCodeInterpreterSettings(candidate.codeInterpreter),
    shell: sanitizeAgentShellSettings(candidate.shell),
  };
}

function expandHomePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (trimmed === '~') return process.env.USERPROFILE || process.env.HOME || trimmed;
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    const home = process.env.USERPROFILE || process.env.HOME || '';
    return home ? path.join(home, trimmed.slice(2)) : trimmed;
  }
  return trimmed.replace(/^%USERPROFILE%/i, process.env.USERPROFILE || '%USERPROFILE%');
}

function sanitizePathList(value: unknown): string[] {
  return dedupeStrings(
    sanitizeStringArray(value).map((entry) => path.resolve(expandHomePath(entry))),
  );
}

export function sanitizeAgentPermissionSettings(
  value: unknown,
  fallback: AgentPermissionSettings = DEFAULT_AGENT_RUNTIME.permissions,
): AgentPermissionSettings {
  const candidate = value && typeof value === 'object' ? value as Partial<AgentPermissionSettings> : {};
  return {
    mode: pickEnum(candidate.mode, VALID_PERMISSION_MODES, fallback.mode),
    readableRoots: sanitizePathList(candidate.readableRoots ?? fallback.readableRoots),
    writableRoots: sanitizePathList(candidate.writableRoots ?? fallback.writableRoots),
    allowedCommandPrefixes: sanitizeStringArray(candidate.allowedCommandPrefixes ?? fallback.allowedCommandPrefixes),
    deniedCommandPrefixes: sanitizeStringArray(candidate.deniedCommandPrefixes ?? fallback.deniedCommandPrefixes),
  };
}

export function sanitizeAgentRuntimeContextSettings(
  value: unknown,
  fallback: AgentRuntimeContextSettings = DEFAULT_AGENT_RUNTIME.context,
): AgentRuntimeContextSettings {
  const candidate = value && typeof value === 'object' ? value as Partial<AgentRuntimeContextSettings> : {};
  return {
    compactionThresholdPercent: sanitizeCompactionThresholdPercent(
      candidate.compactionThresholdPercent,
      fallback.compactionThresholdPercent ?? DEFAULT_CONTEXT_COMPACTION_PERCENT,
    ),
  };
}

export function sanitizeAgentRuntimeSettings(value: unknown): AgentRuntimeSettings {
  const candidate = value && typeof value === 'object' ? value as Partial<AgentRuntimeSettings> : {};
  return {
    permissions: sanitizeAgentPermissionSettings(candidate.permissions),
    context: sanitizeAgentRuntimeContextSettings(candidate.context),
  };
}

export function sanitizeSidebar(
  input: unknown,
  defaults: typeof LEFT_DEFAULTS | typeof RIGHT_DEFAULTS,
  fallback: SidebarLayoutPreference,
): SidebarLayoutPreference {
  const candidate = (input ?? {}) as Partial<SidebarLayoutPreference>;
  const expandedWidth = clamp(
    typeof candidate.expandedWidth === 'number' ? candidate.expandedWidth : fallback.expandedWidth,
    defaults.min,
    defaults.max,
  );

  return {
    collapsed: typeof candidate.collapsed === 'boolean' ? candidate.collapsed : fallback.collapsed,
    expandedWidth,
    width: clamp(
      typeof candidate.width === 'number'
        ? candidate.width
        : fallback.collapsed
          ? defaults.collapsedWidth
          : expandedWidth,
      defaults.collapsedWidth,
      defaults.max,
    ),
  };
}

export function sanitizeTerminal(input: unknown, fallback = DEFAULT_LAYOUT.terminal): LayoutPreferences['terminal'] {
  const candidate = (input ?? {}) as Partial<LayoutPreferences['terminal']>;
  return {
    height: clamp(
      typeof candidate.height === 'number' ? candidate.height : fallback.height,
      TERMINAL_MIN_HEIGHT,
      TERMINAL_MAX_HEIGHT,
    ),
  };
}

export function sanitizeWindow(input: unknown, fallback = DEFAULT_LAYOUT.window): WindowLayoutPreference {
  const candidate = (input ?? {}) as Partial<WindowLayoutPreference>;
  const width = typeof candidate.width === 'number' && Number.isFinite(candidate.width)
    ? Math.trunc(candidate.width)
    : fallback.width;
  const height = typeof candidate.height === 'number' && Number.isFinite(candidate.height)
    ? Math.trunc(candidate.height)
    : fallback.height;
  const x = typeof candidate.x === 'number' && Number.isFinite(candidate.x)
    ? Math.trunc(candidate.x)
    : fallback.x;
  const y = typeof candidate.y === 'number' && Number.isFinite(candidate.y)
    ? Math.trunc(candidate.y)
    : fallback.y;
  return {
    width: clamp(width, APP_MIN_WINDOW_WIDTH, Math.max(APP_MIN_WINDOW_WIDTH, APP_DEFAULT_WINDOW_WIDTH * 4)),
    height: clamp(height, APP_MIN_WINDOW_HEIGHT, Math.max(APP_MIN_WINDOW_HEIGHT, APP_DEFAULT_WINDOW_HEIGHT * 4)),
    x,
    y,
    isMaximized: typeof candidate.isMaximized === 'boolean' ? candidate.isMaximized : fallback.isMaximized,
  };
}
