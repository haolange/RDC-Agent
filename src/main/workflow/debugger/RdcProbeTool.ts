import type { AgentTool, AgentToolResult } from '../../agent-runtime/agent/AgentTool';
import { truncateOutput } from '../../agent-runtime/tools/primitives/_shared';
import { RDC_PROBE_ACTIONS, RDC_PROBE_READONLY_CLI_ACTIONS, RdcProbeInputSchema, compileRdcProbe, type RdcProbeInput } from '@shared/constants/rdcProbe';
import type { RdcCliInvokerSettings } from '@shared/types/settings';
import type { CLIResult } from '@shared/types/tool';
import { rdcCliInvokerService } from '../../tools/RdcCliInvokerService';
import { parseRdcNativeResult } from '../../tools/RdcNativeProtocol';
import { openProbeLease, closeProbeLease } from '../../tools/RdcProbeLifecycle';
import type { RdcTurnBinding } from '../../tools/RdcTurnBindings';
import { assertRdcContextLeaseOwnership, getRdcContextLease, type RdcContextLease } from '../../sessions/RdcRuntimeContextRegistry';

export interface RdcProbeToolDeps {
  getRdcCliSettings?: () => RdcCliInvokerSettings;
  executeCli?: (command: string, args?: string[], options?: { abortSignal?: AbortSignal; settings?: RdcCliInvokerSettings; contextId?: string }) => Promise<CLIResult>;
  getLease?: (sessionId: string | null | undefined) => RdcContextLease | null;
  openLease?: typeof openProbeLease;
  closeLease?: typeof closeProbeLease;
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
    description: 'Query native rdc JSON through the frozen local CLI binding. Lease lifecycle is scoped to the current project capture. Never mutates capture bytes.',
    parameters: {
      type: 'object', required: ['action'], additionalProperties: false,
      properties: {
        action: { type: 'string', enum: [...RDC_PROBE_ACTIONS] },
        capturePath: { type: 'string', description: 'Registered project capture, only for lease_open; local replay defaults. Select remote replay in Capture first.' },
        contextId: { type: 'string', description: 'Must match the context already owned by this session.' },
        args: {
          type: 'object', additionalProperties: false,
          properties: {
            action: { type: 'string', enum: [...RDC_PROBE_READONLY_CLI_ACTIONS] },
            eventId: { type: 'string', description: 'Nonnegative event id, only for event_show/pipeline_show.' },
            path: { type: 'string', description: 'Bounded virtual path, only for vfs_ls/vfs_cat.' },
          },
        },
      },
    },
    permissionHint: 'readonly',
    spec: { isReadOnly: true, isConcurrencySafe: false, isDestructive: false, sideEffect: 'session', category: 'system', requiresApproval: false },
    async execute(_toolCallId, rawArgs, signal, _onUpdate, context) {
      try {
        const parsed = RdcProbeInputSchema.safeParse(rawArgs);
        if (!parsed.success) throw new Error('RDC_PROBE_SCHEMA: ' + parsed.error.issues.map((issue) => issue.message).join('; '));
        const input = parsed.data;
        signal?.throwIfAborted();
        if (context?.excludeRdcLeaseTools) throw new Error('RDC_PROBE_OWNER: offline child cannot access RDC.');
        const binding = context?.rdcBinding;
        const settings = deps.getRdcCliSettings?.() ?? binding?.cli;
        if (!settings?.enabled || !settings.command.trim()) throw new Error('RDC_PROBE_UNCONFIGURED: no frozen native CLI binding.');
        const ownerSession = sessionId ?? context?.sessionId ?? null;
        const ownerProject = projectId ?? context?.projectId ?? null;
        const lifecycle = input.action === 'lease_open' || input.action === 'lease_close';
        let lease = getLease(ownerSession);
        if (!deps.getLease && lease && !assertRdcContextLeaseOwnership({ sessionId: ownerSession, projectId: ownerProject })
          && !(lifecycle && lease.quarantineReason && !lease.delegatedFrom)) {
          throw new Error('RDC_PROBE_OWNER: control is delegated or the binding requires recovery.');
        }
        if (lease && (lease.ownerSessionId !== ownerSession || lease.ownerProjectId !== ownerProject
          || (input.contextId && input.contextId !== lease.contextId))) {
          throw new Error('RDC_PROBE_OWNER: lease ownership/context mismatch.');
        }
        if (lifecycle && !ownerSession) throw new Error('RDC_PROBE_SESSION_REQUIRED: lease lifecycle requires an owning session.');
        if (input.action === 'lease_open' && (!lease || lease.quarantineReason)) {
          if (!binding) throw new Error('RDC_PROBE_UNCONFIGURED: lifecycle needs a frozen action binding.');
          await (deps.openLease ?? openProbeLease)(input, ownerSession!, ownerProject, binding, signal);
          lease = getLease(ownerSession);
        }
        const compiled = compileRdcProbe(input);
        if ((compiled.needsContext || lifecycle) && (!lease || lease.contextId === 'default')) {
          throw new Error('RDC_PROBE_OWNER: no non-default daemon context is owned by this session.');
        }
        if (!deps.getLease && compiled.needsContext && !lifecycle && lease) {
          const identity = binding?.identity;
          if (!identity || identity.ownerSessionId !== ownerSession || identity.version !== lease.version || identity.contextId !== lease.contextId) {
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
        if (input.action === 'lease_close') {
          if (!binding) throw new Error('RDC_PROBE_UNCONFIGURED: lifecycle needs a frozen action binding.');
          await (deps.closeLease ?? closeProbeLease)(ownerSession!, ownerProject, binding as RdcTurnBinding, signal);
        }
        const after = getLease(ownerSession);
        const reprepareRequired = lifecycle && !sameIdentity(binding?.identity ?? null, after);
        const responsePayload = reprepareRequired
          ? {
              ...(payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : { result: payload }),
              reprepareRequired: true,
              message: 'RDC runtime identity changed. Prepare a new turn before any further RDC operation.',
            }
          : payload;
        const text = JSON.stringify(responsePayload);
        const stdout = truncateOutput(text, 16 * 1024);
        return {
          content: [{ type: 'text', text: stdout }],
          details: {
            action: input.action, cliAction: compiled.command, exitCode: cli.exitCode, stdout,
            truncated: stdout !== text, durationMs: cli.duration_ms,
            reprepareRequired,
            worldStateStamp: { sessionId: ownerSession, contextId: after?.contextId ?? null, version: after?.version ?? null },
          },
        };
      } catch (error) { return fail(error); }
    },
  };
}

function sameIdentity(identity: RdcTurnBinding['identity'], lease: RdcContextLease | null): boolean {
  if (!identity || !lease) return identity === null && lease === null;
  return identity.ownerSessionId === lease.ownerSessionId
    && identity.contextId === lease.contextId
    && identity.version === lease.version;
}
