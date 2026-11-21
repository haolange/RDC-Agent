import { CANONICAL_HOOK_EVENTS } from '@shared/types/rdcRuntime';
import { MCP_TRANSPORTS } from '@shared/types/mcp';
import type { useI18n, TranslationKey } from '../../../../i18n';

type Translate = ReturnType<typeof useI18n>['t'];

const isOneOf = <T extends string>(values: readonly T[], value: string): value is T => (values as readonly string[]).includes(value);

/** A hook event in words; an event this build does not know is shown as written so it is never silently renamed. */
export const hookEventLabel = (event: string, t: Translate): string => (
  isOneOf(CANONICAL_HOOK_EVENTS, event) ? t(`settings.hookEvent.${event}` as TranslationKey) : event
);

/** How an MCP server is reached, in words. */
export const mcpTransportLabel = (transport: string, t: Translate): string => (
  isOneOf(MCP_TRANSPORTS, transport) ? t(`settings.mcpTransport.${transport}` as TranslationKey) : transport
);

/** A hook timeout is stored in milliseconds and read in seconds. */
export const timeoutSeconds = (timeoutMs: string): string => {
  const ms = Number(timeoutMs);
  return Number.isFinite(ms) && ms > 0 ? String(Math.round(ms / 100) / 10) : '';
};

/** A command and its JSON argument list as one readable line; arguments with spaces are quoted. */
export const commandLine = (command: string, argsText: string): string => {
  let args: string[] = [];
  try {
    const parsed: unknown = JSON.parse(argsText || '[]');
    if (Array.isArray(parsed)) args = parsed.map(String);
  } catch {
    args = argsText.trim() ? [argsText.trim()] : [];
  }
  return [command, ...args.map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg))].filter(Boolean).join(' ');
};
