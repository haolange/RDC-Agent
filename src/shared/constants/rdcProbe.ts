import { z } from 'zod';

export const RDC_PROBE_ACTIONS = ['enumerate', 'doctor', 'version', 'probe', 'capture_select', 'capture_restore', 'capture_recover', 'preview_status'] as const;
export type RdcProbeAction = (typeof RDC_PROBE_ACTIONS)[number];
export const RDC_PROBE_ACTION_SET = new Set<string>(RDC_PROBE_ACTIONS);

/** Semantic query ids, not executable names or a user-extensible command allowlist. */
export const RDC_PROBE_READONLY_CLI_ACTIONS = [
  'context_status', 'event_list', 'event_search', 'event_show', 'pipeline_show', 'resource_list', 'vfs_ls', 'vfs_cat',
] as const;
export const RDC_PROBE_READONLY_CLI_ACTION_SET = new Set<string>(RDC_PROBE_READONLY_CLI_ACTIONS);
const optionalField = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => value === '' ? undefined : value, schema.optional());
const count = (max: number) => optionalField(z.number().int().min(0).max(max));
const QueryArgs = z.object({
  action: optionalField(z.enum(RDC_PROBE_READONLY_CLI_ACTIONS)),
  eventId: optionalField(z.string().regex(/^\d+$/u)),
  path: optionalField(z.string().min(1).max(512)),
  offset: count(1_000_000),
  limit: optionalField(z.number().int().min(1).max(1000)),
  maxDepth: count(64),
  nameContains: optionalField(z.string().min(1).max(256)),
  eventIdMin: count(Number.MAX_SAFE_INTEGER),
  eventIdMax: count(Number.MAX_SAFE_INTEGER),
  flagsInclude: optionalField(z.array(z.string().regex(/^[A-Za-z]+$/u)).min(1).max(8)),
  maxResults: optionalField(z.number().int().min(1).max(1000)),
}).strict();

/** Query fields each semantic query accepts; everything else is rejected rather than ignored. */
const QUERY_FIELDS: Record<(typeof RDC_PROBE_READONLY_CLI_ACTIONS)[number], readonly string[]> = {
  context_status: [], resource_list: [],
  event_list: ['eventId', 'offset', 'limit', 'maxDepth', 'nameContains'],
  event_search: ['nameContains', 'eventIdMin', 'eventIdMax', 'flagsInclude', 'maxResults'],
  event_show: ['eventId'], pipeline_show: ['eventId'],
  vfs_ls: ['path'], vfs_cat: ['path'],
};

export const RdcProbeInputSchema = z.object({
  action: z.enum(RDC_PROBE_ACTIONS),
  inputId: optionalField(z.string().min(1).max(256)),
  args: QueryArgs.optional(),
}).strict().superRefine((input, ctx) => {
  if (input.action === 'capture_select' && !input.inputId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'capture_select requires inputId.' });
  }
  if (input.action !== 'probe' && input.args && Object.keys(input.args).length > 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Only probe accepts query args.' });
  }
  if (input.inputId && input.action !== 'capture_select') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Only capture_select accepts inputId.' });
  }
  if (input.action === 'probe') {
    const query = input.args?.action ?? 'context_status';
    const event = input.args?.eventId;
    const vfsPath = input.args?.path;
    if (query === 'event_show' && !event) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'event_show requires eventId.' });
    }
    const allowed = QUERY_FIELDS[query];
    for (const [field, value] of Object.entries(input.args ?? {})) {
      if (field !== 'action' && value !== undefined && !allowed.includes(field)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${field} is not allowed for ${query}.` });
      }
    }
    if (query === 'event_search' && !input.args?.nameContains && input.args?.eventIdMin === undefined
      && input.args?.eventIdMax === undefined && !input.args?.flagsInclude) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'event_search requires nameContains, an event id range or flagsInclude.' });
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

export interface CompiledRdcProbe {
  command: string;
  args: string[];
  needsContext: boolean;
  /** Set when the query runs a read-only catalog operation through the generic `call` command. */
  operation?: string;
}

function compileEventQuery(query: 'event_list' | 'event_search', args: NonNullable<RdcProbeInput['args']>, replaySessionId: string | undefined): CompiledRdcProbe {
  if (!replaySessionId) throw new Error('RDC_PROBE_OWNER: no replay session is bound to this context.');
  const native: Record<string, unknown> = { session_id: replaySessionId };
  let operation: string;
  if (query === 'event_list') {
    operation = 'rd.event.get_action_tree';
    if (args.eventId) native.event_id = Number(args.eventId);
    if (args.offset !== undefined) native.offset = args.offset;
    if (args.limit !== undefined) native.limit = args.limit;
    if (args.maxDepth !== undefined) native.max_depth = args.maxDepth;
    if (args.nameContains) native.filter = { name_contains: args.nameContains };
  } else {
    operation = 'rd.event.search_actions';
    const search: Record<string, unknown> = {};
    if (args.nameContains) search.name_contains = args.nameContains;
    if (args.eventIdMin !== undefined) search.event_id_min = args.eventIdMin;
    if (args.eventIdMax !== undefined) search.event_id_max = args.eventIdMax;
    if (args.flagsInclude) search.flags_include = args.flagsInclude;
    native.query = search;
    if (args.maxResults !== undefined) native.max_results = args.maxResults;
  }
  return { command: 'call', args: [operation, '--args-json', JSON.stringify(native)], needsContext: true, operation };
}

/** Compile only parser-backed native rdc commands. Global args are added by the invoker. */
export function compileRdcProbe(input: RdcProbeInput, replaySessionId?: string): CompiledRdcProbe {
  const parsed = RdcProbeInputSchema.parse(input);
  if (parsed.action === 'capture_select' || parsed.action === 'capture_restore' || parsed.action === 'capture_recover') {
    throw new Error('RDC_PROBE_LIFECYCLE: capture lifecycle is not a CLI probe query.');
  }
  if (parsed.action === 'version' || parsed.action === 'doctor') {
    return { command: parsed.action, args: parsed.action === 'version' ? ['--json'] : [], needsContext: false };
  }
  if (parsed.action === 'enumerate') return { command: 'tools', args: ['list'], needsContext: false };
  if (parsed.action === 'preview_status') return { command: 'session', args: ['preview', 'status'], needsContext: true };
  const query = parsed.args?.action ?? 'context_status';
  if (query === 'event_list' || query === 'event_search') return compileEventQuery(query, parsed.args!, replaySessionId);
  const [command, verb] = query.split('_');
  const args = [verb!];
  if (parsed.args?.eventId) args.push('--event-id', parsed.args.eventId);
  if (query.startsWith('vfs_')) args.push('--path', parsed.args?.path ?? '/');
  return { command: command!, args, needsContext: true };
}
