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
            timeoutMs: 30_000,
          },
        },
      },
    }),
  },
}));

import { RdcCliInvokerService } from './RdcCliInvokerService';

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

import { operationFingerprint, RDC_APPLICATION_OPERATIONS } from './RdcOperationCatalog';
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
  timeoutMs: 30000,
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
