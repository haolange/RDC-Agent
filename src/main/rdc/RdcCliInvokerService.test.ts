import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { rdcInstallationFiles } from '../platform/rdcLayout';

vi.mock('../settings/settings-core/SettingsService', () => ({
  settingsService: {
    snapshot: () => ({
      revision: 1,
      user: {
        tooling: {
          rdcCli: {
            enabled: false,
            command: '',
            argsPrefix: [],
            workingDirectory: '',
            env: {},
            noProgressTimeoutMs: 30_000,
          },
        },
      },
    }),
  },
}));

import { RdcCliInvokerService } from './RdcCliInvokerService';
import {
  RDC_CANCEL_CLOSE_GRACE_MS,
  RDC_CANCEL_TIMEOUT_MS,
  RDC_CONTROL_TIMEOUT_MS,
  RDC_HEARTBEAT_GAP_MS,
} from './RdcOperationWatcher';
import { operationFingerprint, RDC_APPLICATION_OPERATIONS } from './RdcOperationCatalog';
import type { CLIResult, ShellInvocationRequest } from '../tools/ShellInvocationService';

describe('RdcCliInvokerService.getRuntimeSummary', () => {
  it('returns diagnostic fields without recommendedSpecialists', async () => {
    const summary = await new RdcCliInvokerService().getRuntimeSummary();
    expect(summary).toMatchObject({
      runtime: expect.objectContaining({
        source: 'unconfigured',
        command: '',
        intermediateRoot: expect.stringMatching(/rdc-tool-intermediate$/u),
      }),
      cli: expect.objectContaining({
        available: false,
      }),
      namespaces: expect.any(Array),
    });
    expect(summary).not.toHaveProperty('recommendedSpecialists');
    expect(JSON.stringify(summary)).not.toContain('recommendedSpecialists');
  });
});

it('reports RDC-Tool artifacts that are not artifact records as a protocol failure', async () => {
  const service = new RdcCliInvokerService();
  vi.spyOn(service, 'executeCLI').mockResolvedValue({
    exitCode: 0,
    stdout: JSON.stringify({ ok: true, result_kind: 'rd.event.list', data: {}, artifacts: [{ path: 3 }] }),
    stderr: '',
    duration_ms: 1,
  });
  const response = await service.call({ toolName: 'rd.event.list', args: {}, runId: 'run' });
  expect(response).toMatchObject({
    ok: false,
    error: { code: 'EXECUTION_ERROR', message: expect.stringContaining('RDC_CLI_PROTOCOL') },
  });
});

it('tags context-scoped action invocation ownership separately from native argv', async () => {
  const service = new RdcCliInvokerService();
  const invoke = vi.spyOn(service, 'executeCLI').mockResolvedValue({
    exitCode: 1,
    stdout: '',
    stderr: 'orphan',
    duration_ms: 1,
    processExitReason: 'unconfirmed_orphan',
  });
  await service.call({ toolName: 'rd.shader.replace', args: {}, contextId: 'owned-context', runId: 'run' });
  expect(invoke).toHaveBeenCalledWith(
    'call',
    expect.arrayContaining(['--daemon-context', 'owned-context']),
    expect.objectContaining({ contextId: 'owned-context', runId: 'run' }),
  );
});

const roots = [0, 1].map(() => fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-binding-test-')));
for (const root of roots) {
  for (const file of [rdcInstallationFiles(root).python, rdcInstallationFiles(root).entry]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'fixture');
  }
}
afterAll(() => roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true })));
const cli = {
  enabled: true,
  command: rdcInstallationFiles(roots[0]).python,
  argsPrefix: [rdcInstallationFiles(roots[0]).entry],
  workingDirectory: '',
  env: {},
  noProgressTimeoutMs: 30_000,
};
const operation = {
  name: 'rd.event.get_action_tree',
  namespace: 'event',
  description: 'Read events',
  input_schema: { type: 'object', additionalProperties: false, properties: {} },
  scope: 'replay',
  effects: [],
  evidence_kind: null,
  path_inputs: [],
  execution_budget: {
    rule: 'no_progress',
    default_no_progress_ms: 300_000,
    min_no_progress_ms: 30_000,
    max_no_progress_ms: 3_600_000,
  },
};
const reply = (kind: string, data: unknown) => ({
  exitCode: 0,
  stdout: JSON.stringify({ ok: true, schema_version: '3.0.0', result_kind: kind, data }),
  stderr: '',
  duration_ms: 1,
});
const applicationOperations = Object.entries(RDC_APPLICATION_OPERATIONS).map(([name, contract]) => ({
  ...operation,
  name,
  namespace: name.split('.')[1],
  scope: contract.scope,
  effects: contract.effects,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: [],
    properties: Object.fromEntries(Object.entries(contract.parameters).map(([name, type]) => [name, { type }])),
  },
}));
// The catalog this test build "ships against" is the fixture catalog the fake installation serves.
const fixtureCatalog = {
  fingerprint: operationFingerprint(applicationOperations),
  toolCount: applicationOperations.length,
};
const versionCatalog = {
  schema_version: '1',
  fingerprint: fixtureCatalog.fingerprint,
  tool_count: fixtureCatalog.toolCount,
};
const versionReply = (catalog: unknown = versionCatalog) =>
  reply('rdc_tool.version', { tool_version: 'installed-build', schema_version: '3.0.0', catalog });
const invoker = () => new RdcCliInvokerService(undefined, () => fixtureCatalog);
const catalogReply = () =>
  reply('rdc_tool.tools.list', {
    schema_version: '1',
    tools: applicationOperations,
    tool_count: applicationOperations.length,
    fingerprint: operationFingerprint(applicationOperations),
  });
describe('configured CLI contract gate', () => {
  it('loads and deeply freezes the catalog from the same frozen installation', async () => {
    const service = invoker();
    const execute = vi
      .spyOn(service, 'executeCLI')
      .mockResolvedValueOnce(versionReply())
      .mockResolvedValueOnce(catalogReply());
    const catalog = await service.loadCatalog(cli);
    expect(catalog.tools).toHaveLength(applicationOperations.length);
    expect(Object.isFrozen(catalog.tools[0].input_schema.properties)).toBe(true);
    expect(execute.mock.calls[0][2]?.settings).toEqual(cli);
    expect(Object.isFrozen(execute.mock.calls[0][2]?.settings?.env)).toBe(true);
  });
  it.each([
    ['empty build identity', reply('rdc_tool.version', { tool_version: '', schema_version: '3.0.0' })],
    ['wrong kind', reply('other', { tool_version: 'installed-build', schema_version: '3.0.0' })],
    ['wrong schema', reply('rdc_tool.version', { tool_version: 'installed-build', schema_version: '2.0.0' })],
    ['CLI failure', { exitCode: 2, stdout: '', stderr: 'bad CLI', duration_ms: 1 }],
  ])('rejects %s before catalog use', async (_name, response) => {
    const service = invoker();
    const execute = vi.spyOn(service, 'executeCLI').mockResolvedValue(response);
    await expect(service.loadCatalog(cli)).rejects.toThrow();
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['fingerprint', { tools: [operation], tool_count: 1, fingerprint: '0'.repeat(64) }],
    ['empty', { tools: [], tool_count: 0, fingerprint: operationFingerprint([]) }],
    [
      'unknown effect',
      {
        tools: [{ ...operation, effects: ['safe'] }],
        tool_count: 1,
        fingerprint: operationFingerprint([{ ...operation, effects: ['safe'] }]),
      },
    ],
  ])('rejects invalid catalog %s and allows a corrected retry', async (_name, data) => {
    const service = invoker();
    vi.spyOn(service, 'executeCLI')
      .mockResolvedValueOnce(versionReply())
      .mockResolvedValueOnce(reply('rdc_tool.tools.list', { schema_version: '1', ...data }))
      .mockResolvedValueOnce(versionReply())
      .mockResolvedValueOnce(catalogReply());
    await expect(service.loadCatalog(cli)).rejects.toThrow();
    expect((await service.loadCatalog(cli)).tool_count).toBe(applicationOperations.length);
  });
  it('keys catalog by executable, prefix, environment and working directory', async () => {
    const service = invoker();
    const execute = vi
      .spyOn(service, 'executeCLI')
      .mockImplementation(async (command) => (command === 'version' ? versionReply() : catalogReply()));
    const first = await service.loadCatalog(cli);
    for (const other of [
      { ...cli, command: rdcInstallationFiles(roots[1]).python, argsPrefix: [rdcInstallationFiles(roots[1]).entry] },
      { ...cli, argsPrefix: ['cli/run_cli.py'] },
      { ...cli, env: { X: 'B' } },
      { ...cli, workingDirectory: roots[0] },
    ]) {
      expect(await service.loadCatalog(other)).not.toBe(first);
    }
    expect(await service.loadCatalog(cli)).toBe(first);
    expect(execute).toHaveBeenCalledTimes(10);
  });
});

it.each([
  ['missing', undefined],
  ['a fixed duration', { rule: 'timeout', timeout_ms: 60_000 }],
  ['a default outside its range', { ...operation.execution_budget, default_no_progress_ms: 10_000 }],
  ['an extra field', { ...operation.execution_budget, grace_ms: 5_000 }],
])('rejects an operation whose execution budget is %s', async (_name, budget) => {
  const tools = structuredClone(applicationOperations).map((tool, index) =>
    index === 0 ? { ...tool, execution_budget: budget } : tool,
  );
  const service = invoker();
  vi.spyOn(service, 'executeCLI')
    .mockResolvedValueOnce(versionReply())
    .mockResolvedValueOnce(
      reply('rdc_tool.tools.list', {
        schema_version: '1',
        tools,
        tool_count: tools.length,
        fingerprint: operationFingerprint(JSON.parse(JSON.stringify(tools))),
      }),
    );
  await expect(service.loadCatalog(cli)).rejects.toMatchObject({
    code: 'RDC_UPGRADE_REQUIRED',
    message: expect.stringContaining('unrecognized operation contract'),
  });
});

it.each(['schema', 'missing operation', 'missing argument'])(
  'rejects incompatible application catalog: %s',
  async (failure) => {
    const tools = structuredClone(applicationOperations);
    if (failure === 'missing operation') tools.pop();
    if (failure === 'missing argument') delete tools[0].input_schema.properties.file_path;
    const service = invoker();
    vi.spyOn(service, 'executeCLI')
      .mockResolvedValueOnce(versionReply())
      .mockResolvedValueOnce(
        reply('rdc_tool.tools.list', {
          schema_version: failure === 'schema' ? 'unknown' : '1',
          tools,
          tool_count: tools.length,
          fingerprint: operationFingerprint(tools),
        }),
      );
    await expect(service.loadCatalog(cli)).rejects.toThrow(/UPGRADE_REQUIRED/);
  },
);

it('rechecks an installation updated at the same command path at the next boundary', async () => {
  const service = invoker();
  const execute = vi
    .spyOn(service, 'executeCLI')
    .mockResolvedValueOnce(versionReply())
    .mockResolvedValueOnce(catalogReply());
  const frozen = await service.loadCatalog(cli);
  execute.mockResolvedValueOnce(versionReply()).mockResolvedValueOnce(
    reply('rdc_tool.tools.list', {
      schema_version: '1',
      tools: [],
      tool_count: 0,
      fingerprint: operationFingerprint([]),
    }),
  );
  await expect(service.loadCatalog(cli, true)).rejects.toThrow(/UPGRADE/);
  expect(frozen.tools.length).toBe(applicationOperations.length);
});

it.each(['1.0.0', '2.0.0', 'local-build'])(
  'validates capabilities independently of package identity %s',
  async (identity) => {
    const service = invoker();
    vi.spyOn(service, 'executeCLI')
      .mockResolvedValueOnce(
        reply('rdc_tool.version', { tool_version: identity, schema_version: '3.0.0', catalog: versionCatalog }),
      )
      .mockResolvedValueOnce(catalogReply());
    expect((await service.loadCatalog(cli)).tool_count).toBe(applicationOperations.length);
  },
);

it('injects the host intermediate root into every CLI spawn env', async () => {
  const invoke = vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', duration_ms: 1 });
  const service = new RdcCliInvokerService({ invoke } as never);
  await service.executeCLI('version', ['--json'], { settings: cli });
  expect(invoke.mock.calls[0][0].env.RDC_TOOL_INTERMEDIATE_ROOT).toMatch(/rdc-tool-intermediate$/u);
  // Undefined deletes inherited Python settings at spawn. Empty values remain
  // present in Windows environment blocks and caused real ADB stdout loss.
  expect(invoke.mock.calls[0][0].env).toHaveProperty('PYTHONHOME', undefined);
  expect(invoke.mock.calls[0][0].env).toHaveProperty('PYTHONPATH', undefined);
});

it('lifts owner-pid for context-scoped CLI invocations', async () => {
  const invoke = vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', duration_ms: 1 });
  const service = new RdcCliInvokerService({ invoke } as never);
  vi.spyOn(service, 'loadCatalog').mockResolvedValue({} as never);
  await service.executeCLI('call', ['rd.capture.open_file', '--daemon-context', 'rdc-owned'], {
    settings: cli,
    contextId: 'rdc-owned',
  });
  expect(invoke.mock.calls[0][0].args.slice(2, 6)).toEqual([
    '--daemon-context',
    'rdc-owned',
    '--owner-pid',
    String(process.pid),
  ]);
  expect(invoke.mock.calls[0][0].args).toContain('call');
});

it('fails closed before lifecycle or ordinary execution on an invalid installation', async () => {
  const invoke = vi.fn();
  const service = new RdcCliInvokerService({ invoke } as never);
  for (const command of ['call', 'context', 'daemon']) {
    const result = await service.executeCLI(command, ['open'], { settings: { ...cli, command: 'C:/Tools/rdc.bat' } });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('RDC_BAT_REJECTED');
  }
  expect(invoke).not.toHaveBeenCalled();
});

it('invalidates cached success after a bound entry disappears', async () => {
  const service = invoker();
  const execute = vi
    .spyOn(service, 'executeCLI')
    .mockImplementation(async (command) => (command === 'version' ? versionReply() : catalogReply()));
  await service.loadCatalog(cli);
  const entry = cli.argsPrefix[0];
  const bytes = fs.readFileSync(entry);
  try {
    fs.unlinkSync(entry);
    await expect(service.loadCatalog(cli)).rejects.toThrow('RDC_BINDING_INVALID');
  } finally {
    fs.writeFileSync(entry, bytes);
  }
  await service.loadCatalog(cli);
  expect(execute).toHaveBeenCalledTimes(4);
});

describe('RDC-Tool catalog identity', () => {
  it.each([
    [
      'an installation that does not report its catalog',
      reply('rdc_tool.version', { tool_version: 'installed-build', schema_version: '3.0.0' }),
      'RDC_UPGRADE_REQUIRED',
    ],
    [
      'a version report that disagrees with the served catalog',
      versionReply({ ...versionCatalog, fingerprint: '1'.repeat(64) }),
      'RDC_CATALOG_MISMATCH',
    ],
  ])('rejects %s', async (_case, version, code) => {
    const service = invoker();
    vi.spyOn(service, 'executeCLI').mockResolvedValueOnce(version).mockResolvedValueOnce(catalogReply());
    await expect(service.loadCatalog(cli, true)).rejects.toMatchObject({ code });
  });

  it('rejects a consistent installation that serves another catalog than this build ships against', async () => {
    const service = new RdcCliInvokerService(undefined, () => ({ ...fixtureCatalog, fingerprint: '2'.repeat(64) }));
    vi.spyOn(service, 'executeCLI').mockResolvedValueOnce(versionReply()).mockResolvedValueOnce(catalogReply());
    await expect(service.loadCatalog(cli, true)).rejects.toMatchObject({
      code: 'RDC_CATALOG_MISMATCH',
      message: expect.stringContaining(`this RDC-Agent needs 222222222222 (${fixtureCatalog.toolCount} operations)`),
    });
  });
});

describe('RDC operation watcher', () => {
  type Run = { request: ShellInvocationRequest; finish: (result?: Partial<CLIResult>) => void };
  const watched = () => {
    const runs: Run[] = [];
    const invoke = vi.fn(
      (request: ShellInvocationRequest) =>
        new Promise<CLIResult>((resolve) => {
          const finish = (result: Partial<CLIResult> = {}) =>
            resolve({ exitCode: 0, stdout: '', stderr: '', duration_ms: 1, ...result });
          request.abortSignal?.addEventListener('abort', () => finish({ exitCode: 137, processExitReason: 'abort' }));
          runs.push({ request, finish });
        }),
    );
    const service = new RdcCliInvokerService({ invoke } as never);
    vi.spyOn(service, 'loadCatalog').mockResolvedValue({} as never);
    return { service, runs };
  };
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const call = ['rd.event.get_action_tree', '--args-json', '{}', '--daemon-context', 'rdc-owned'];
  const requestIdOf = (run: Run) => run.request.args![run.request.args!.indexOf('--request-id') + 1];
  const envelope = JSON.stringify({
    ok: true,
    result_kind: 'rd.event.get_action_tree',
    data: { context_id: 'rdc-owned' },
  });

  it('runs an operation without a process wall, carrying the frozen budget, a request id and the stream', async () => {
    const { service, runs } = watched();
    const frames: string[] = [];
    const running = service.executeCLI('call', call, {
      settings: { ...cli, noProgressTimeoutMs: 45_000 },
      contextId: 'rdc-owned',
      onProgress: (frame) => frames.push(frame.kind),
    });
    await settle();
    const [{ request, finish }] = runs;
    const args = request.args!;
    expect(request.timeoutMs).toBeNull();
    expect(args.slice(args.indexOf('call'))).toEqual([
      ...['call', 'rd.event.get_action_tree', '--args-json', '{}'],
      ...['--no-progress-ms', '45000', '--request-id', requestIdOf(runs[0]), '--progress-stream'],
    ]);
    expect(requestIdOf(runs[0])).toMatch(/^rdc-agent-[0-9a-f-]{36}$/u);
    const id = requestIdOf(runs[0]);
    request.onStderrLine!(JSON.stringify({ kind: 'heartbeat', request_id: id, ts_ms: 1, state: 'queued' }));
    request.onStderrLine!('rdc-tool: plain diagnostic');
    request.onStderrLine!(
      JSON.stringify({
        kind: 'progress',
        request_id: id,
        trace_id: 't',
        operation: 'rd.event.get_action_tree',
        stage: 'walk',
        message: 'Walking actions',
        progress_pct: null,
        details: {},
        ts_ms: 2,
      }),
    );
    request.onStderrLine!(
      JSON.stringify({
        kind: 'native_call',
        request_id: id,
        trace_id: 't',
        name: 'GetRootActions',
        phase: 'enter',
        ts_ms: 3,
      }),
    );
    finish({ stdout: envelope, stderr: 'raw frames and text' });
    const result = await running;
    expect(frames).toEqual(['heartbeat', 'progress', 'native_call']);
    expect(result.stderr).toBe('rdc-tool: plain diagnostic');
    expect(result.cancellation).toBeUndefined();
  });

  it('reports a malformed or foreign frame as a protocol failure once the operation ends', async () => {
    const { service, runs } = watched();
    const running = service.executeCLI('call', call, { settings: cli, contextId: 'rdc-owned' });
    await settle();
    runs[0].request.onStderrLine!(
      JSON.stringify({ kind: 'heartbeat', request_id: 'someone-else', ts_ms: 1, state: 'running' }),
    );
    runs[0].finish({ stdout: envelope });
    await expect(running).rejects.toMatchObject({ code: 'RDC_CLI_PROTOCOL' });
  });

  it('treats a frame gap beyond the CLI limit as an unresponsive daemon and stops the CLI', async () => {
    vi.useFakeTimers();
    try {
      const { service, runs } = watched();
      const running = service.executeCLI('call', call, { settings: cli, contextId: 'rdc-owned' });
      const outcome = running.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(0);
      const id = requestIdOf(runs[0]);
      runs[0].request.onStderrLine!(JSON.stringify({ kind: 'heartbeat', request_id: id, ts_ms: 1, state: 'running' }));
      await vi.advanceTimersByTimeAsync(RDC_HEARTBEAT_GAP_MS);
      expect(runs[0].request.abortSignal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(runs[0].request.abortSignal?.aborted).toBe(true);
      expect(await outcome).toMatchObject({
        code: 'RDC_DAEMON_UNRESPONSIVE',
        params: { operation: 'rd.event.get_action_tree', seconds: 21 },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('bounds control commands by the control deadline and shortcut queries by the frozen patience', async () => {
    const invoke = vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', duration_ms: 1 });
    const service = new RdcCliInvokerService({ invoke } as never);
    vi.spyOn(service, 'loadCatalog').mockResolvedValue({} as never);
    await service.executeCLI('daemon', ['status', '--daemon-context', 'rdc-owned'], { settings: cli });
    await service.executeCLI('pipeline', ['show', '--daemon-context', 'rdc-owned'], { settings: cli });
    expect(invoke.mock.calls.map(([request]) => request.timeoutMs)).toEqual([
      RDC_CONTROL_TIMEOUT_MS,
      cli.noProgressTimeoutMs,
    ]);
    expect(invoke.mock.calls.flatMap(([request]) => request.args)).not.toContain('--progress-stream');
  });

  it.each([
    ['it closes within the grace after the receipt', true],
    ['it is killed once that grace ends', false],
  ])('cancels through the daemon, then waits for the exec CLI: %s', async (_case, closes) => {
    vi.useFakeTimers();
    try {
      const { service, runs } = watched();
      const controller = new AbortController();
      const running = service.executeCLI('call', call, {
        settings: cli,
        contextId: 'rdc-owned',
        abortSignal: controller.signal,
      });
      await vi.advanceTimersByTimeAsync(0);
      const id = requestIdOf(runs[0]);
      controller.abort();
      await vi.advanceTimersByTimeAsync(0);
      const cancel = runs[1].request;
      expect(cancel.args!.slice(cancel.args!.indexOf('daemon'))).toEqual(['daemon', 'cancel', '--request-id', id]);
      expect(cancel.args).toEqual(expect.arrayContaining(['--daemon-context', 'rdc-owned']));
      expect(cancel.timeoutMs).toBe(RDC_CANCEL_TIMEOUT_MS);
      expect(cancel.abortSignal).toBeUndefined();
      expect(runs[0].request.abortSignal?.aborted).toBe(false);
      runs[1].finish({
        stdout: JSON.stringify({
          ok: true,
          result_kind: 'rdc_tool.daemon.cancel',
          data: { request_id: id, trace_id: 't', outcome: 'cancelled', settled_at_ms: 5 },
        }),
      });
      await vi.advanceTimersByTimeAsync(RDC_CANCEL_CLOSE_GRACE_MS - 1);
      expect(runs[0].request.abortSignal?.aborted).toBe(false);
      if (closes) runs[0].finish({ exitCode: 1, stdout: envelope });
      await vi.advanceTimersByTimeAsync(1);
      expect(runs[0].request.abortSignal?.aborted).toBe(!closes);
      await expect(running).resolves.toMatchObject({
        exitCode: closes ? 1 : 137,
        cancellation: { status: 'settled', outcome: 'cancelled', traceId: 't' },
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
