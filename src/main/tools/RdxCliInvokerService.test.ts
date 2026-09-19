import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('../settings/SettingsService', () => ({
  settingsService: {
    getAll: () => ({
      tooling: {
        rdxCli: {
          enabled: false,
          command: '',
          argsPrefix: [],
          workingDirectory: '',
          env: {},
          timeoutMs: 30_000,
        },
      },
    }),
  },
}));

import { RdxCliInvokerService } from './RdxCliInvokerService';

describe('RdxCliInvokerService.getRuntimeSummary', () => {
  it('returns diagnostic fields without recommendedSpecialists', async () => {
    const summary = await new RdxCliInvokerService().getRuntimeSummary();
    expect(summary).toMatchObject({
      runtime: expect.objectContaining({
        source: 'unconfigured',
        command: '',
        intermediateRoot: expect.stringMatching(/rdx-intermediate$/u),
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

it('tags context-scoped action invocation ownership separately from native argv', async () => {
  const service = new RdxCliInvokerService();
  const invoke = vi.spyOn(service, 'executeCLI').mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'orphan', duration_ms: 1, processExitReason: 'unconfirmed_orphan' });
  await service.call({ toolName: 'rd.shader.replace', args: {}, contextId: 'owned-context', runId: 'run' });
  expect(invoke).toHaveBeenCalledWith('call', expect.arrayContaining(['--daemon-context', 'owned-context']), expect.objectContaining({ contextId: 'owned-context', runId: 'run' }));
});

import { operationFingerprint, RDX_APPLICATION_OPERATIONS } from './RdxOperationCatalog';
const roots = [0, 1].map(() => fs.mkdtempSync(path.join(os.tmpdir(), 'rdx-binding-test-')));
for (const root of roots) {
  fs.mkdirSync(path.join(root, 'binaries/windows/x64/python'), { recursive: true });
  fs.mkdirSync(path.join(root, 'cli'));
  fs.writeFileSync(path.join(root, 'binaries/windows/x64/python/python.exe'), 'fixture');
  fs.writeFileSync(path.join(root, 'cli/run_cli.py'), 'fixture');
}
afterAll(() => roots.forEach(root => fs.rmSync(root, { recursive: true, force: true })));
const cli = { enabled: true, command: path.join(roots[0], 'binaries/windows/x64/python/python.exe'), argsPrefix: [path.join(roots[0], 'cli/run_cli.py')], workingDirectory: '', env: {}, timeoutMs: 30000 };
const operation = { name: 'rd.event.get_action_tree', namespace: 'event', description: 'Read events',
  input_schema: { type: 'object', additionalProperties: false, properties: {} }, scope: 'replay', effects: [], evidence_kind: null, path_inputs: [] };
const reply = (kind: string, data: unknown) => ({ exitCode: 0, stdout: JSON.stringify({ ok: true, schema_version: '3.0.0', result_kind: kind, data }), stderr: '', duration_ms: 1 });
const versionReply = () => reply('rdx.version', { tool_version: 'installed-build', schema_version: '3.0.0' });
const applicationOperations = Object.entries(RDX_APPLICATION_OPERATIONS).map(([name, contract]) => ({ ...operation, name, namespace: name.split('.')[1], scope: contract.scope, effects: contract.effects, input_schema: { type: 'object', additionalProperties: false, required: [], properties: Object.fromEntries(Object.entries(contract.parameters).map(([name, type]) => [name, { type }])) } }));
const catalogReply = () => reply('rdx.tools.list', { schema_version: '1', tools: applicationOperations, tool_count: applicationOperations.length, fingerprint: operationFingerprint(applicationOperations) });
describe('configured CLI contract gate', () => {
  it('loads and deeply freezes the catalog from the same frozen installation', async () => {
    const service = new RdxCliInvokerService();
    const execute = vi.spyOn(service, 'executeCLI').mockResolvedValueOnce(versionReply()).mockResolvedValueOnce(catalogReply());
    const catalog = await service.loadCatalog(cli);
    expect(catalog.tools).toHaveLength(applicationOperations.length);
    expect(Object.isFrozen(catalog.tools[0].input_schema.properties)).toBe(true);
    expect(execute.mock.calls[0][2]?.settings).toEqual(cli);
    expect(Object.isFrozen(execute.mock.calls[0][2]?.settings?.env)).toBe(true);
  });
  it.each([
    ['empty build identity', reply('rdx.version', { tool_version: '', schema_version: '3.0.0' })],
    ['wrong kind', reply('other', { tool_version: 'installed-build', schema_version: '3.0.0' })],
    ['wrong schema', reply('rdx.version', { tool_version: 'installed-build', schema_version: '2.0.0' })],
    ['CLI failure', { exitCode: 2, stdout: '', stderr: 'bad CLI', duration_ms: 1 }],
  ])('rejects %s before catalog use', async (_name, response) => {
    const service = new RdxCliInvokerService(); const execute = vi.spyOn(service, 'executeCLI').mockResolvedValue(response);
    await expect(service.loadCatalog(cli)).rejects.toThrow(); expect(execute).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['fingerprint', { tools: [operation], tool_count: 1, fingerprint: '0'.repeat(64) }],
    ['empty', { tools: [], tool_count: 0, fingerprint: operationFingerprint([]) }],
    ['unknown effect', { tools: [{ ...operation, effects: ['safe'] }], tool_count: 1, fingerprint: operationFingerprint([{ ...operation, effects: ['safe'] }]) }],
  ])('rejects invalid catalog %s and allows a corrected retry', async (_name, data) => {
    const service = new RdxCliInvokerService();
    vi.spyOn(service, 'executeCLI').mockResolvedValueOnce(versionReply()).mockResolvedValueOnce(reply('rdx.tools.list', { schema_version: '1', ...data }))
      .mockResolvedValueOnce(versionReply()).mockResolvedValueOnce(catalogReply());
    await expect(service.loadCatalog(cli)).rejects.toThrow();
    expect((await service.loadCatalog(cli)).tool_count).toBe(applicationOperations.length);
  });
  it('keys catalog by executable, prefix, environment and working directory', async () => {
    const service = new RdxCliInvokerService(); const execute = vi.spyOn(service, 'executeCLI').mockImplementation(async command => command === 'version' ? versionReply() : catalogReply());
    const first = await service.loadCatalog(cli);
    for (const other of [{ ...cli, command: path.join(roots[1], 'binaries/windows/x64/python/python.exe'), argsPrefix: [path.join(roots[1], 'cli/run_cli.py')] }, { ...cli, argsPrefix: ['cli/run_cli.py'] }, { ...cli, env: { X: 'B' } }, { ...cli, workingDirectory: roots[0] }]) {
      expect(await service.loadCatalog(other)).not.toBe(first);
    }
    expect(await service.loadCatalog(cli)).toBe(first); expect(execute).toHaveBeenCalledTimes(10);
  });
});

it.each(['schema', 'missing operation', 'missing argument'])('rejects incompatible application catalog: %s', async failure => {
  const tools = structuredClone(applicationOperations);
  if (failure === 'missing operation') tools.pop();
  if (failure === 'missing argument') delete tools[0].input_schema.properties.file_path;
  const service = new RdxCliInvokerService();
  vi.spyOn(service, 'executeCLI').mockResolvedValueOnce(versionReply()).mockResolvedValueOnce(reply('rdx.tools.list', {
    schema_version: failure === 'schema' ? 'unknown' : '1', tools, tool_count: tools.length, fingerprint: operationFingerprint(tools),
  }));
  await expect(service.loadCatalog(cli)).rejects.toThrow(/UPGRADE_REQUIRED/);
});

it('rechecks an installation updated at the same command path at the next boundary', async () => {
  const service = new RdxCliInvokerService();
  const execute = vi.spyOn(service, 'executeCLI').mockResolvedValueOnce(versionReply()).mockResolvedValueOnce(catalogReply());
  const frozen = await service.loadCatalog(cli);
  execute.mockResolvedValueOnce(versionReply()).mockResolvedValueOnce(reply('rdx.tools.list', { schema_version: '1', tools: [], tool_count: 0, fingerprint: operationFingerprint([]) }));
  await expect(service.loadCatalog(cli, true)).rejects.toThrow(/UPGRADE/);
  expect(frozen.tools.length).toBe(applicationOperations.length);
});

it.each(['1.0.0', '2.0.0', 'local-build'])('validates capabilities independently of package identity %s', async identity => {
  const service = new RdxCliInvokerService();
  vi.spyOn(service, 'executeCLI').mockResolvedValueOnce(reply('rdx.version', { tool_version: identity, schema_version: '3.0.0' })).mockResolvedValueOnce(catalogReply());
  expect((await service.loadCatalog(cli)).tool_count).toBe(applicationOperations.length);
});

it('injects the host intermediate root into every CLI spawn env', async () => {
  const invoke = vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', duration_ms: 1 });
  const service = new RdxCliInvokerService({ invoke } as never);
  await service.executeCLI('version', ['--json'], { settings: cli });
  expect(invoke.mock.calls[0][0].env.RDX_INTERMEDIATE_ROOT).toMatch(/rdx-intermediate$/u);
});

it('lifts owner-pid for context-scoped CLI invocations', async () => {
  const invoke = vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', duration_ms: 1 });
  const service = new RdxCliInvokerService({ invoke } as never);
  vi.spyOn(service, 'loadCatalog').mockResolvedValue({} as never);
  await service.executeCLI('call', ['rd.capture.open_file', '--daemon-context', 'rdc-owned'], { settings: cli, contextId: 'rdc-owned' });
  expect(invoke.mock.calls[0][0].args.slice(2, 6)).toEqual(['--daemon-context', 'rdc-owned', '--owner-pid', String(process.pid)]);
  expect(invoke.mock.calls[0][0].args).toContain('call');
});

it('fails closed before lifecycle or ordinary execution on an invalid installation', async () => {
  const invoke = vi.fn();
  const service = new RdxCliInvokerService({ invoke } as never);
  for (const command of ['call', 'context', 'daemon']) {
    const result = await service.executeCLI(command, ['open'], { settings: { ...cli, command: 'C:/Tools/rdx.bat' } });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('RDX_BAT_REJECTED');
  }
  expect(invoke).not.toHaveBeenCalled();
});

it('invalidates cached success after a bound entry disappears', async () => {
  const service = new RdxCliInvokerService();
  const execute = vi.spyOn(service, 'executeCLI').mockImplementation(async command => command === 'version' ? versionReply() : catalogReply());
  await service.loadCatalog(cli);
  const entry = cli.argsPrefix[0]; const bytes = fs.readFileSync(entry);
  try { fs.unlinkSync(entry); await expect(service.loadCatalog(cli)).rejects.toThrow('RDX_BINDING_INVALID'); }
  finally { fs.writeFileSync(entry, bytes); }
  await service.loadCatalog(cli);
  expect(execute).toHaveBeenCalledTimes(4);
});
