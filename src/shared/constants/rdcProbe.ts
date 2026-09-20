import { z } from 'zod';

export const RDC_PROBE_ACTIONS = ['enumerate', 'doctor', 'version', 'probe', 'lease_open', 'lease_close', 'preview_status'] as const;
export type RdcProbeAction = (typeof RDC_PROBE_ACTIONS)[number];
export const RDC_PROBE_ACTION_SET = new Set<string>(RDC_PROBE_ACTIONS);

/** Semantic query ids, not executable names or a user-extensible command allowlist. */
export const RDC_PROBE_READONLY_CLI_ACTIONS = [
  'context_status', 'event_list', 'event_show', 'pipeline_show', 'resource_list', 'vfs_ls', 'vfs_cat',
] as const;
export const RDC_PROBE_READONLY_CLI_ACTION_SET = new Set<string>(RDC_PROBE_READONLY_CLI_ACTIONS);
const QueryArgs = z.object({
  action: z.enum(RDC_PROBE_READONLY_CLI_ACTIONS).optional(),
  eventId: z.string().regex(/^\d+$/u).optional(),
  path: z.string().min(1).max(512).optional(),
}).strict();

export const RdcProbeInputSchema = z.object({
  action: z.enum(RDC_PROBE_ACTIONS),
  capturePath: z.string().min(1).optional(),
  contextId: z.string().min(1).optional(),
  args: QueryArgs.optional(),
}).strict().superRefine((input, ctx) => {
  if (input.action !== 'probe' && input.args && Object.keys(input.args).length > 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Only probe accepts query args.' });
  }
  if (input.capturePath && input.action !== 'lease_open') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Only lease_open accepts capturePath.' });
  }
  if (input.action === 'probe') {
    const query = input.args?.action ?? 'context_status';
    const event = input.args?.eventId;
    const vfsPath = input.args?.path;
    if (query === 'event_show' && !event) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'event_show requires eventId.' });
    }
    if (event && !['event_show', 'pipeline_show'].includes(query)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'eventId is not allowed for this query.' });
    }
    if (vfsPath && !['vfs_ls', 'vfs_cat'].includes(query)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'path is not allowed for this query.' });
    }
    if (['vfs_ls', 'vfs_cat'].includes(query)) {
      const p = vfsPath ?? '/';
      if (!p.startsWith('/') || p.includes('\\') || p.split('/').includes('..')
        || [...p].some((character) => character.charCodeAt(0) < 32) || (query === 'vfs_cat' && ['/', '/draws', '/resources', '/textures', '/buffers'].includes(p))) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'VFS reads require a bounded, canonical virtual path.' });
      }
    }
  }
});
export type RdcProbeInput = z.infer<typeof RdcProbeInputSchema>;

/** Compile only parser-backed native rdc commands. Global args are added by the invoker. */
export function compileRdcProbe(input: RdcProbeInput): { command: string; args: string[]; needsContext: boolean } {
  const parsed = RdcProbeInputSchema.parse(input);
  if (parsed.action === 'version' || parsed.action === 'doctor') {
    return { command: parsed.action, args: parsed.action === 'version' ? ['--json'] : [], needsContext: false };
  }
  if (parsed.action === 'enumerate') return { command: 'tools', args: ['list'], needsContext: false };
  if (parsed.action === 'preview_status') return { command: 'session', args: ['preview', 'status'], needsContext: true };
  const query = parsed.args?.action ?? 'context_status';
  const [command, verb] = query.split('_');
  const args = [verb!];
  if (parsed.args?.eventId) args.push('--event-id', parsed.args.eventId);
  if (query.startsWith('vfs_')) args.push('--path', parsed.args?.path ?? '/');
  return { command: command!, args, needsContext: true };
}
