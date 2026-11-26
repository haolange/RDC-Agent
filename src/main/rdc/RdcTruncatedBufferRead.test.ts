import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_RDC_CLI_INVOKER } from '@shared/constants/appSettingsDefaults';
import { freezeRdcTurnBinding } from './RdcTurnBindings';
import { executeRdcShell } from './executeRdcShell';
import type { ToolExecutionContext } from '../agent-runtime/agent/AgentTool';
import type { RdcOperationDefinition } from './RdcOperationCatalog';

const mock = vi.hoisted(() => ({ execute: vi.fn(), lease: vi.fn(), quarantine: vi.fn(), observe: vi.fn() }));
vi.mock('./RdcSessionService', () => ({ rdcSessionService: { observeAgentOperation: mock.observe } }));
vi.mock('./RdcCliInvokerService', () => ({ rdcCliInvokerService: { executeCLI: mock.execute } }));
vi.mock('./RdcRuntimeContextRegistry', () => ({
  assertRdcContextLeaseOwnership: mock.lease,
  getRdcContextLease: vi.fn(),
  quarantineRdcContext: mock.quarantine,
}));

const lease = {
  contextId: 'owned-context',
  version: 7,
  ownerProjectId: 'project',
  ownerSessionId: 'session',
  runtimeContext: { replaySessionId: 'native-replay', captureFileId: 'native-capture' },
};
const definition: RdcOperationDefinition = {
  name: 'rd.pipeline.get_constant_buffers',
  namespace: 'pipeline',
  description: 'Read constant buffers',
  scope: 'replay',
  effects: ['replay_position'],
  evidence_kind: null,
  path_inputs: [],
  prerequisites: [{ requires: 'session_id' }],
  input_schema: {
    type: 'object',
    properties: {
      session_id: { type: 'string' },
      stage: { type: 'string' },
      event_id: { type: 'integer' },
      include_contents: { type: 'boolean' },
    },
    required: ['session_id', 'stage'],
    additionalProperties: false,
  },
};
const context: ToolExecutionContext = {
  workspaceRoot: '/project',
  projectRootPath: '/project',
  projectId: 'project',
  sessionId: 'session',
  turnId: 'turn',
  agentId: 'general',
  rdcBinding: freezeRdcTurnBinding(
    { ...DEFAULT_RDC_CLI_INVOKER, enabled: true, command: 'native-rdc' },
    [definition],
    lease,
  ),
};
const input = { operation: definition.name, args: { stage: 'ps', event_id: 19, include_contents: true } };

function snapshot(event: number, workerGeneration = 'windows-filetime:200') {
  return {
    exitCode: 0,
    stdout: JSON.stringify({
      ok: true,
      result_kind: 'rd.session.get_context',
      meta: {
        process_identity: {
          status: 'available',
          daemon: { pid: 31, start_generation: 'windows-filetime:100' },
          worker: { pid: 32, start_generation: workerGeneration },
        },
      },
      data: {
        context_id: lease.contextId,
        current_session_id: 'native-replay',
        runtime: { active_event_id: event },
        sessions: [{ session_id: 'native-replay', capture_file_id: 'native-capture', shader_replacements: [] }],
      },
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.execute.mockReset();
  mock.lease.mockReturnValue(lease);
});

it('keeps a verified replay usable after oversized constant-buffer output and suggests a bounded read', async () => {
  mock.execute
    .mockResolvedValueOnce(snapshot(11))
    .mockResolvedValueOnce({
      exitCode: 0,
      stdout: 'private incomplete output',
      stdoutTruncated: true,
      stdoutByteLength: 11_411_997,
    })
    .mockResolvedValueOnce(snapshot(19));

  await expect(executeRdcShell(input, 'buffer-read', undefined, context)).rejects.toThrow(
    /RDC_CLI_OUTPUT_TRUNCATED:.*Replay verified at event 19; select a reflection slot/s,
  );
  expect(mock.quarantine).not.toHaveBeenCalled();
  expect(mock.observe).toHaveBeenCalledWith(
    { sessionId: 'session', projectId: 'project' },
    definition.name,
    'buffer-read',
    context.rdcBinding!.cli,
    true,
  );
});

it.each([
  { exitCode: 0, workerGeneration: 'windows-filetime:999' },
  { exitCode: 1, workerGeneration: 'windows-filetime:200' },
])('quarantines an oversized read when process identity or successful exit is unverified: %j', async (failure) => {
  mock.execute
    .mockResolvedValueOnce(snapshot(11))
    .mockResolvedValueOnce({
      exitCode: failure.exitCode,
      stdout: 'private incomplete output',
      stdoutTruncated: true,
      stdoutByteLength: 11_411_997,
    })
    .mockResolvedValueOnce(snapshot(19, failure.workerGeneration));

  await expect(executeRdcShell(input, 'buffer-read', undefined, context)).rejects.toThrow('RDC_CLI_OUTPUT_TRUNCATED');
  expect(mock.quarantine).toHaveBeenCalledOnce();
  expect(mock.observe).not.toHaveBeenCalled();
});
