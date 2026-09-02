import { z } from 'zod';

export const RDX_PROBE_ACTIONS = [
  'enumerate',
  'doctor',
  'version',
  'probe',
  'lease_open',
  'lease_close',
  'preview_status',
] as const;

export type RdxProbeAction = (typeof RDX_PROBE_ACTIONS)[number];

export const RDX_PROBE_ACTION_SET = new Set<string>(RDX_PROBE_ACTIONS);

/**
 * Closed Settings-facing keys rdx_probe may invoke through tooling.rdxCli.
 * Settings today has a generic CLI invoker, not named read-only actions —
 * this allowlist is the only action surface Mission may reach.
 */
export const RDX_PROBE_READONLY_CLI_ACTIONS = [
  'enumerate',
  'doctor',
  'version',
  'probe',
  'preview-status',
  'preview_status',
  'lease-open',
  'lease_open',
  'lease-close',
  'lease_close',
] as const;

export const RDX_PROBE_READONLY_CLI_ACTION_SET = new Set<string>(RDX_PROBE_READONLY_CLI_ACTIONS);

const RDX_PROBE_MUTATE_ACTION_PATTERN = /(?:shader[-_.]?replace|replay[-_.]?mutate|write[-_.]?capture|edit[-_.]?capture|apply[-_.]?patch|hotfix|argv)/i;

export const RdxProbeInputSchema = z.object({
  action: z.enum(RDX_PROBE_ACTIONS),
  capturePath: z.string().min(1).optional(),
  contextId: z.string().min(1).optional(),
  args: z.record(z.string(), z.string()).optional(),
}).strict();

export type RdxProbeInput = z.infer<typeof RdxProbeInputSchema>;

export function isRdxProbeMutateActionName(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return RDX_PROBE_MUTATE_ACTION_PATTERN.test(trimmed);
}

export function resolveRdxProbeCliAction(action: RdxProbeAction, args?: Record<string, string>): string {
  if (action === 'preview_status') return 'preview-status';
  if (action === 'lease_open') return 'lease-open';
  if (action === 'lease_close') return 'lease-close';
  if (action === 'probe') {
    const requested = (args?.action ?? args?.name ?? 'probe').trim();
    if (!requested || isRdxProbeMutateActionName(requested)) {
      throw new Error(`RDX_PROBE_MUTATE_DENIED: probe action "${requested}" is not a read-only Settings action.`);
    }
    if (!RDX_PROBE_READONLY_CLI_ACTION_SET.has(requested)) {
      throw new Error(`RDX_PROBE_ACTION_DENIED: "${requested}" is not on the rdx_probe read-only allowlist.`);
    }
    return requested === 'preview_status' ? 'preview-status' : requested;
  }
  return action;
}

export function assertRdxProbeArgsReadOnly(args?: Record<string, string>): void {
  if (!args) return;
  for (const [key, value] of Object.entries(args)) {
    if (isRdxProbeMutateActionName(key) || isRdxProbeMutateActionName(value)) {
      throw new Error(`RDX_PROBE_MUTATE_DENIED: argument "${key}" is not a read-only Settings action.`);
    }
    if (key === 'argv' || key === 'rawArgv' || key === 'command') {
      throw new Error('RDX_PROBE_MUTATE_DENIED: arbitrary argv / command passthrough is forbidden.');
    }
  }
}
