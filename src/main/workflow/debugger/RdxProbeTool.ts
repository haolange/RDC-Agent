import { createHash } from 'crypto';
import type { AgentTool, AgentToolResult, ToolExecutionContext } from '../../agent-runtime/agent/AgentTool';
import { truncateOutput } from '../../agent-runtime/tools/primitives/_shared';
import {
  RDX_PROBE_ACTIONS,
  RdxProbeInputSchema,
  assertRdxProbeArgsReadOnly,
  isRdxProbeMutateActionName,
  resolveRdxProbeCliAction,
  type RdxProbeAction,
  type RdxProbeInput,
} from '@shared/constants/rdxProbe';
import type { RdxCliInvokerSettings } from '@shared/types/settings';
import type { CLIResult } from '@shared/types/tool';
import { TOOL_RESULT_ARTIFACTIZE_THRESHOLD_BYTES } from '@shared/types/sessionArtifact';
import { settingsService } from '../../settings/SettingsService';
import { rdxCliInvokerService } from '../../tools/RdxCliInvokerService';
import {
  getRdxContextLease,
  setRdxRuntimeContextForSession,
  type RdxContextLease,
} from '../../sessions/RdxRuntimeContextRegistry';
import type { RdxRuntimeContext } from '@shared/types/session';

const RDC_MAGIC = Buffer.from('RDOC');
const STDOUT_INLINE_LIMIT = 16 * 1024;

export interface RdxProbeToolDeps {
  getRdxCliSettings?: () => RdxCliInvokerSettings;
  executeCli?: (
    command: string,
    args?: string[],
    options?: { abortSignal?: AbortSignal },
  ) => Promise<CLIResult>;
  getLease?: (sessionId: string | null | undefined) => RdxContextLease | null;
  setLease?: typeof setRdxRuntimeContextForSession;
}

function readConfiguredCli(settings: RdxCliInvokerSettings): string {
  if (!settings.enabled || !settings.command.trim()) {
    throw new Error('RDX_PROBE_UNCONFIGURED: Settings tooling.rdxCli is not enabled or has no command.');
  }
  return settings.command.trim();
}

function looksLikeRdcBytes(text: string): boolean {
  if (!text) return false;
  const sample = Buffer.from(text.slice(0, 8), 'utf8');
  if (sample.subarray(0, 4).equals(RDC_MAGIC)) return true;
  let suspicious = 0;
  const limit = Math.min(text.length, 256);
  for (let index = 0; index < limit; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 0 || (code < 9 && code !== 9 && code !== 10 && code !== 13)) {
      suspicious += 1;
    }
  }
  return suspicious >= 3;
}

function sanitizeStdout(stdout: string): { text: string; truncated: boolean; omittedBinary: boolean } {
  if (looksLikeRdcBytes(stdout)) {
    return {
      text: '[omitted: raw .rdc or binary capture bytes are never returned to the model]',
      truncated: true,
      omittedBinary: true,
    };
  }
  const truncated = truncateOutput(stdout, STDOUT_INLINE_LIMIT);
  return {
    text: truncated,
    truncated: truncated !== stdout,
    omittedBinary: false,
  };
}

function buildCliArgs(input: RdxProbeInput, sessionId: string | null): string[] {
  const args: string[] = [];
  if (input.capturePath) args.push('--capture-path', input.capturePath);
  if (input.contextId) args.push('--daemon-context', input.contextId);
  if (sessionId) args.push('--session-id', sessionId);
  for (const [key, value] of Object.entries(input.args ?? {})) {
    if (key === 'action' || key === 'name') continue;
    if (!/^[A-Za-z0-9_-]+$/u.test(key)) {
      throw new Error(`RDX_PROBE_ACTION_DENIED: argument key "${key}" is not allowlisted.`);
    }
    args.push(`--${key}`, value);
  }
  return args;
}

function worldStateStamp(lease: RdxContextLease | null, sessionId: string | null) {
  return {
    sessionId,
    contextId: lease?.contextId ?? null,
    captureHash: lease?.captureHash ?? null,
    version: lease?.version ?? null,
    updatedAt: lease?.updatedAt ?? null,
  };
}

function fail(message: string, extras: Record<string, unknown> = {}): AgentToolResult<Record<string, unknown>> {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
    details: { code: message.split(':')[0], ...extras },
  };
}

function successPayload(payload: Record<string, unknown>): AgentToolResult<Record<string, unknown>> {
  const serialized = JSON.stringify(payload);
  const overThreshold = Buffer.byteLength(serialized, 'utf8') > TOOL_RESULT_ARTIFACTIZE_THRESHOLD_BYTES;
  return {
    content: [{ type: 'text', text: serialized }],
    details: {
      ...payload,
      artifactRef: overThreshold ? 'pending-tool-output' : null,
    },
  };
}

export function createRdxProbeTool(
  sessionId?: string | null,
  projectId?: string | null,
  deps: RdxProbeToolDeps = {},
): AgentTool<RdxProbeInput, Record<string, unknown>> {
  const getSettings = deps.getRdxCliSettings ?? (() => settingsService.getAll().tooling.rdxCli);
  const executeCli = deps.executeCli ?? ((command, args, options) => (
    rdxCliInvokerService.executeCLI(command, args, options)
  ));
  const getLease = deps.getLease ?? getRdxContextLease;
  const setLease = deps.setLease ?? setRdxRuntimeContextForSession;

  return {
    name: 'rdx_probe',
    label: 'RDX Probe',
    description: 'Run a Settings-configured read-only RDX CLI action (enumerate, doctor, version, probe, lease open/close, preview-status). Never mutates captures and never returns raw .rdc bytes.',
    parameters: {
      type: 'object',
      required: ['action'],
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: [...RDX_PROBE_ACTIONS],
          description: 'Read-only RDX probe action.',
        },
        capturePath: { type: 'string', description: 'Optional capture path injected into the configured CLI action.' },
        contextId: { type: 'string', description: 'Optional daemon context id injected into the configured CLI action.' },
        args: {
          type: 'object',
          additionalProperties: false,
          properties: {
            action: { type: 'string', description: 'Read-only probe sub-action when action is probe.' },
            name: { type: 'string', description: 'Alias for probe sub-action name.' },
          },
          description: 'Optional closed string arguments. Mutate action names and arbitrary argv are rejected.',
        },
      },
    },
    permissionHint: 'readonly',
    spec: {
      isReadOnly: true,
      isConcurrencySafe: false,
      isDestructive: false,
      sideEffect: 'session',
      category: 'system',
      requiresApproval: false,
    },
    async execute(
      _toolCallId,
      rawArgs,
      signal,
      _onUpdate,
      context?: ToolExecutionContext,
    ): Promise<AgentToolResult<Record<string, unknown>>> {
      const parsed = RdxProbeInputSchema.safeParse(rawArgs ?? {});
      if (!parsed.success) {
        return fail(`RDX_PROBE_SCHEMA: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`);
      }
      const input = parsed.data;
      try {
        assertRdxProbeArgsReadOnly(input.args);
        if (input.action !== 'probe' && input.args) {
          for (const value of Object.values(input.args)) {
            if (isRdxProbeMutateActionName(value)) {
              throw new Error(`RDX_PROBE_MUTATE_DENIED: argument value "${value}" is not a read-only Settings action.`);
            }
          }
        }
        const settings = getSettings();
        readConfiguredCli(settings);
        const resolvedSessionId = sessionId ?? context?.sessionId ?? null;
        const resolvedProjectId = projectId ?? context?.projectId ?? null;
        const cliAction = resolveRdxProbeCliAction(input.action as RdxProbeAction, input.args);
        const cliArgs = buildCliArgs(input, resolvedSessionId);

        if (input.action === 'lease_open' || input.action === 'lease_close') {
          if (!resolvedSessionId) {
            return fail('RDX_PROBE_SESSION_REQUIRED: lease_open/close only bind the current session.');
          }
        }

        const cli = await executeCli(cliAction, cliArgs, { abortSignal: signal });
        const stdout = sanitizeStdout(cli.stdout ?? '');

        if (input.action === 'lease_open' && resolvedSessionId) {
          const existing = getLease(resolvedSessionId);
          const contextId = input.contextId?.trim()
            || existing?.contextId
            || `probe-${createHash('sha256').update(resolvedSessionId).digest('hex').slice(0, 12)}`;
          const runtimeContext: RdxRuntimeContext = {
            contextId,
            runtimeOwner: existing?.runtimeContext.runtimeOwner ?? 'rdc-agent',
            ownerLeaseId: existing?.runtimeContext.ownerLeaseId ?? `lease-${resolvedSessionId}`,
            backend: existing?.runtimeContext.backend ?? 'local',
            updatedAt: Date.now(),
            captureFileId: existing?.runtimeContext.captureFileId,
            captureId: existing?.runtimeContext.captureId,
            raw: {
              ...(existing?.runtimeContext.raw ?? {}),
              capturePath: input.capturePath,
              source: 'rdx_probe',
            },
          };
          setLease(resolvedSessionId, runtimeContext, { projectId: resolvedProjectId });
        }
        if (input.action === 'lease_close' && resolvedSessionId) {
          setLease(resolvedSessionId, null);
        }

        const lease = resolvedSessionId ? getLease(resolvedSessionId) : null;
        return successPayload({
          action: input.action,
          cliAction,
          exitCode: cli.exitCode,
          stdout: stdout.text,
          truncated: stdout.truncated,
          omittedBinary: stdout.omittedBinary,
          durationMs: cli.duration_ms,
          worldStateStamp: worldStateStamp(lease, resolvedSessionId),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return fail(message.startsWith('RDX_PROBE_') ? message : `RDX_PROBE_FAILED: ${message}`);
      }
    },
  };
}
