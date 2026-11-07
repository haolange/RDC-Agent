import type { AgentTool, AgentToolResult } from '../agent/AgentTool';
import type { JsonSchema } from '../core/types';
import { truncateOutput } from '../tools/primitives/_shared';
import { RDC_PROBE_ACTIONS, RDC_PROBE_READONLY_CLI_ACTIONS, RdcProbeInputSchema, compileRdcProbe, type RdcProbeInput } from '@shared/constants/rdcProbe';
import type { RdcCliInvokerSettings } from '@shared/types/settings';
import type { CLIResult } from '@shared/types/tool';
import { rdcCliInvokerService } from '../../rdc/RdcCliInvokerService';
import { parseRdcNativeResult } from '../../rdc/RdcNativeProtocol';
import { assertRdcContextLeaseOwnership, getRdcContextLease, type RdcContextLease } from '../../rdc/RdcRuntimeContextRegistry';

const probeQueryParameters: JsonSchema = {
  type: 'object',
  required: ['action'],
  additionalProperties: false,
  oneOf: [
    ...(['context_status', 'event_list', 'resource_list'] as const).map((action) => ({
      type: 'object', required: ['action'], additionalProperties: false,
      properties: { action: { const: action } },
    })),
    {
      type: 'object', required: ['action', 'eventId'], additionalProperties: false,
      properties: { action: { const: 'event_show' }, eventId: { type: 'string', pattern: '^\\d+$' } },
    },
    {
      type: 'object', required: ['action'], additionalProperties: false,
      properties: { action: { const: 'pipeline_show' }, eventId: { type: 'string', pattern: '^\\d+$' } },
    },
    {
      type: 'object', required: ['action'], additionalProperties: false,
      properties: { action: { const: 'vfs_ls' }, path: { type: 'string', minLength: 1, maxLength: 512 } },
    },
    {
      type: 'object', required: ['action', 'path'], additionalProperties: false,
      properties: { action: { const: 'vfs_cat' }, path: { type: 'string', minLength: 1, maxLength: 512 } },
    },
  ],
  properties: {
    action: { type: 'string', enum: [...RDC_PROBE_READONLY_CLI_ACTIONS] },
    eventId: { type: 'string', pattern: '^\\d+$', description: 'Only event_show or pipeline_show.' },
    path: { type: 'string', minLength: 1, maxLength: 512, description: 'Only vfs_ls or vfs_cat.' },
  },
};

const probeParameters: JsonSchema = {
  type: 'object', required: ['action'], additionalProperties: false,
  oneOf: [
    {
      type: 'object', required: ['action', 'args'], additionalProperties: false,
      properties: { action: { const: 'probe' }, args: probeQueryParameters },
    },
    {
      type: 'object', required: ['action', 'inputId'], additionalProperties: false,
      properties: { action: { const: 'capture_select' }, inputId: { type: 'string', minLength: 1, maxLength: 256 } },
    },
    ...(['enumerate', 'doctor', 'version', 'capture_restore', 'capture_recover', 'preview_status'] as const).map((action) => ({
      type: 'object', required: ['action'], additionalProperties: false,
      properties: { action: { const: action } },
    })),
  ],
  properties: {
    action: { type: 'string', enum: [...RDC_PROBE_ACTIONS] },
    inputId: { type: 'string', minLength: 1, maxLength: 256, description: 'Only capture_select, using an input frozen in the approved plan.' },
    args: probeQueryParameters,
  },
};

export interface RdcProbeToolDeps {
  getRdcCliSettings?: () => RdcCliInvokerSettings;
  executeCli?: (command: string, args?: string[], options?: { abortSignal?: AbortSignal; settings?: RdcCliInvokerSettings; contextId?: string }) => Promise<CLIResult>;
  getLease?: (sessionId: string | null | undefined) => RdcContextLease | null;
}
function fail(error: unknown): AgentToolResult<Record<string, unknown>> {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: 'text', text: message }], isError: true, details: { code: message.split(':')[0] } };
}

export function createRdcProbeTool(
  sessionId?: string | null, projectId?: string | null, deps: RdcProbeToolDeps = {},
): AgentTool<RdcProbeInput, Record<string, unknown>> {
  const executeCli = deps.executeCli ?? ((command, args, options) => rdcCliInvokerService.executeCLI(command, args, options));
  const getLease = deps.getLease ?? getRdcContextLease;
  return {
    name: 'rdc_probe', label: 'RDC Probe',
    description: 'Read native RDC JSON through the frozen session binding. Successful probe queries expose a session evidence URI/hash for explicit delegation; check truncated before treating the returned observation as complete. For an approved capture plan, the owning General may select a frozen inputId, recover a quarantined same-input failure, or restore the original capture and position. Join relevant child executions and close interrupted experiments before recovery; repeated identical failures stop. The runtime checks the owning device, permissions, identity and receipts; never supply filesystem paths or context IDs. Event list: {"action":"probe","args":{"action":"event_list"}}.',
    parameters: probeParameters,
    permissionHint: 'readonly',
    spec: { isReadOnly: true, isConcurrencySafe: false, isDestructive: false, sideEffect: 'session', category: 'system', requiresApproval: false },
    async execute(_toolCallId, rawArgs, signal, _onUpdate, context) {
      try {
        const parsed = RdcProbeInputSchema.safeParse(rawArgs);
        if (!parsed.success) throw new Error('RDC_PROBE_SCHEMA: ' + parsed.error.issues.map((issue) => issue.message).join('; ')
          + ' Example event list: {"action":"probe","args":{"action":"event_list"}}. Omit fields unrelated to the chosen action; placeholders such as "." are not valid event IDs or VFS paths.');
        const input = parsed.data;
        signal?.throwIfAborted();
        if (context?.excludeRdcLeaseTools) throw new Error('RDC_PROBE_OWNER: offline child cannot access RDC.');
        const binding = context?.rdcBinding;
        const settings = deps.getRdcCliSettings?.() ?? binding?.cli;
        if (!settings?.enabled || !settings.command.trim()) throw new Error('RDC_PROBE_UNCONFIGURED: no frozen native CLI binding.');
        const ownerSession = sessionId ?? context?.sessionId ?? null;
        const ownerProject = projectId ?? context?.projectId ?? null;
        if (input.action === 'capture_select' || input.action === 'capture_restore' || input.action === 'capture_recover') {
          if (!ownerSession || !ownerProject || context?.sessionId !== ownerSession || context.projectId !== ownerProject
            || context.agentId !== 'general' || context.accessCeiling !== 'full' || !context.turnId || !context.captureControl) {
            throw new Error('RDC_CAPTURE_SCOPE_DENIED: the approved owning General turn is required.');
          }
          const changed = input.action === 'capture_select'
            ? await context.captureControl.select(input.inputId!, signal)
            : input.action === 'capture_recover' ? await context.captureControl.recover(signal)
              : { ...await context.captureControl.restore(signal), current: undefined };
          signal?.throwIfAborted();
          const current = changed.current ? {
            inputId: changed.current.inputId, contentSha256: changed.current.contentSha256,
            deviceId: changed.current.deviceId, eventId: changed.current.native.eventId, target: changed.current.target,
          } : null;
          const payload = { action: input.action, changed: changed.changed, ...(changed.receipt ? { receipt: changed.receipt } : {}),
            ...(input.action === 'capture_select' || input.action === 'capture_recover' ? { current } : {}) };
          return { content: [{ type: 'text', text: JSON.stringify(payload) }], details: payload };
        }
        const lease = getLease(ownerSession);
        if (!deps.getLease && lease && !assertRdcContextLeaseOwnership({ sessionId: ownerSession, projectId: ownerProject })) {
          throw new Error('RDC_PROBE_OWNER: control is delegated or the binding requires recovery.');
        }
        if (lease && (lease.ownerSessionId !== ownerSession || lease.ownerProjectId !== ownerProject)) {
          throw new Error('RDC_PROBE_OWNER: lease ownership/context mismatch.');
        }
        const compiled = compileRdcProbe(input);
        if (compiled.needsContext && (!lease || lease.contextId === 'default')) {
          throw new Error('RDC_PROBE_OWNER: no non-default daemon context is owned by this session.');
        }
        if (!deps.getLease && compiled.needsContext && lease) {
          const identity = binding?.identity;
          if (!identity || identity.ownerSessionId !== ownerSession || identity.version !== lease.version || identity.contextId !== lease.contextId
            || identity.runtimeContext?.captureFileId !== lease.runtimeContext.captureFileId
            || identity.runtimeContext?.replaySessionId !== lease.runtimeContext.replaySessionId) {
            throw new Error('RDC_PROBE_OWNER: binding changed since prepareTurn; prepare a new turn.');
          }
        }
        const args = [...compiled.args];
        if (lease && compiled.needsContext) args.push('--daemon-context', lease.contextId);
        const cli = await executeCli(compiled.command, args, { abortSignal: signal, settings, contextId: lease?.contextId });
        signal?.throwIfAborted();
        const expectedContext = compiled.command === 'context' ? lease?.contextId : undefined;
        const payload = parseRdcNativeResult(cli, expectedContext);
        const current = getLease(ownerSession);
        if (lease && (!current || current.version !== lease.version || current.contextId !== lease.contextId)) {
          throw new Error('RDC_PROBE_OWNER: lease changed during the call.');
        }
        const text = JSON.stringify(payload);
        const stdout = truncateOutput(text, 16 * 1024);
        return {
          content: [{ type: 'text', text: stdout }],
          details: {
            action: input.action, cliAction: compiled.command, exitCode: cli.exitCode, stdout,
            truncated: stdout !== text, durationMs: cli.duration_ms,
            worldStateStamp: { sessionId: ownerSession, contextId: current?.contextId ?? null, version: current?.version ?? null },
          },
        };
      } catch (error) { return fail(error); }
    },
  };
}
