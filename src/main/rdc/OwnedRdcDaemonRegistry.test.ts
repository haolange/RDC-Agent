import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { rdcInstallationFiles } from '../platform/rdcLayout';

vi.mock('../runtime/RuntimeLogService', () => ({ runtimeLogService: { log: vi.fn() } }));
vi.mock('../settings/settings-core/SettingsService', () => ({
  settingsService: {
    snapshot: () => ({
      revision: 1,
      user: {
        tooling: {
          rdcCli: { enabled: true, command: 'rdc', argsPrefix: [], workingDirectory: '', env: {}, timeoutMs: 1_000 },
        },
      },
    }),
  },
}));
vi.mock('./RdcCliInvokerService', () => ({ rdcCliInvokerService: { executeCLI: vi.fn() } }));
vi.mock('../runtime/AppPathService', () => ({
  appPathService: {
    getAppStatePaths: () => ({ appStateRoot: 'unused' }),
    getUserRdcPaths: () => ({ rdcIntermediateRoot: 'unused' }),
  },
}));
import {
  harvestOwnedRdcDaemons,
  isAppRdcContextId,
  listAppDaemonContextsInIntermediateRoot,
  rememberOwnedRdcDaemon,
  listOwnedRdcDaemons,
} from './OwnedRdcDaemonRegistry';
import type { ProcessIdentity, ProcessLiveness, ProcessTermination } from '../platform/process';

const tempDirs: string[] = [];
const makeRoot = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-owned-daemon-'));
  tempDirs.push(root);
  return root;
};
afterEach(() => {
  for (const root of tempDirs.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const contextId = 'rdc-11111111-2222-3333-4444-555555555555';
const otherId = 'rdc-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('OwnedRdcDaemonRegistry', () => {
  it('accepts only application rdc-uuid contexts', () => {
    expect(isAppRdcContextId(contextId)).toBe(true);
    expect(isAppRdcContextId('default')).toBe(false);
    expect(isAppRdcContextId('task-123')).toBe(false);
  });

  it('lists only rdc-* daemon state files from the App intermediate root', () => {
    const intermediateRoot = path.join(makeRoot(), 'rdc-tool-intermediate');
    const runtime = path.join(intermediateRoot, 'runtime', 'rdc_tool_cli');
    fs.mkdirSync(runtime, { recursive: true });
    fs.writeFileSync(path.join(runtime, `daemon_state_${contextId}.json`), '{}');
    fs.writeFileSync(path.join(runtime, 'daemon_state.json'), '{}');
    fs.writeFileSync(path.join(runtime, 'daemon_state_other.json'), '{}');
    expect(listAppDaemonContextsInIntermediateRoot(intermediateRoot)).toEqual([contextId]);
  });

  it('harvests only the target context through official clear then stop', async () => {
    const root = makeRoot();
    const intermediateRoot = path.join(root, 'rdc-tool-intermediate');
    const registryPath = path.join(root, 'owned-rdc-daemons.json');
    rememberOwnedRdcDaemon(
      {
        contextId,
        command: 'rdc',
        intermediateRoot,
        ownerPid: process.pid,
        ownerBirth: '',
        daemonPid: 1,
        daemonBirth: '',
        workerPid: 2,
        workerBirth: '',
        startedAt: 1,
      },
      { registryPath },
    );
    rememberOwnedRdcDaemon(
      {
        contextId: otherId,
        command: 'rdc',
        intermediateRoot,
        ownerPid: process.pid,
        ownerBirth: '',
        daemonPid: 3,
        daemonBirth: '',
        workerPid: 4,
        workerBirth: '',
        startedAt: 1,
      },
      { registryPath },
    );
    const execute = vi.fn(async (command: string, args: string[]) => {
      const id = args[args.lastIndexOf('--daemon-context') + 1];
      const kind = command === 'context' ? 'rdc_tool.context.clear' : 'rdc_tool.daemon.stop';
      return {
        exitCode: 0,
        stdout: JSON.stringify({ ok: true, result_kind: kind, data: { context_id: id, stopped: true } }),
        stderr: '',
        duration_ms: 1,
      };
    });
    const result = await harvestOwnedRdcDaemons({
      registryPath,
      intermediateRoot,
      execute: execute as never,
      settings: { enabled: true, command: 'rdc', argsPrefix: [], workingDirectory: '', env: {}, timeoutMs: 1_000 },
    });
    expect(result.released.sort()).toEqual([otherId, contextId].sort());
    expect(result.failed).toEqual([]);
    expect(execute.mock.calls.filter((call) => call[0] === 'context')).toHaveLength(2);
    expect(execute.mock.calls.filter((call) => call[0] === 'daemon')).toHaveLength(2);
    expect(
      execute.mock.calls.every((call) => {
        const id = call[1][call[1].lastIndexOf('--daemon-context') + 1];
        return id === contextId || id === otherId;
      }),
    ).toBe(true);
  });

  it('leaves daemon state without an ownership record running instead of assuming it is ours', async () => {
    const root = makeRoot();
    const intermediateRoot = path.join(root, 'rdc-tool-intermediate');
    fs.mkdirSync(path.join(intermediateRoot, 'runtime', 'rdc_tool_cli'), { recursive: true });
    fs.writeFileSync(path.join(intermediateRoot, 'runtime', 'rdc_tool_cli', `daemon_state_${contextId}.json`), '{}');
    const execute = vi.fn();
    const terminateProcess = vi.fn();
    const result = await harvestOwnedRdcDaemons({
      registryPath: path.join(root, 'owned-rdc-daemons.json'),
      intermediateRoot,
      execute,
      terminateProcess,
    });
    expect(result).toEqual({ released: [], failed: [], unconfirmed: [contextId] });
    expect(execute).not.toHaveBeenCalled();
    expect(terminateProcess).not.toHaveBeenCalled();
  });

  it('reports an unreadable registry without stopping anything or throwing', async () => {
    const root = makeRoot();
    const registryPath = path.join(root, 'owned-rdc-daemons.json');
    fs.writeFileSync(registryPath, '{"schemaVersion":1,"records":');
    const execute = vi.fn();
    const result = await harvestOwnedRdcDaemons({ registryPath, intermediateRoot: root, execute });
    expect(result.released).toEqual([]);
    expect(result.failed).toEqual([{ contextId: 'owned-rdc-daemons.json', error: expect.any(String) }]);
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects a registry record that is not one this app writes instead of treating it as ours', () => {
    const root = makeRoot();
    const registryPath = path.join(root, 'owned-rdc-daemons.json');
    fs.writeFileSync(
      registryPath,
      JSON.stringify({
        schemaVersion: 1,
        records: {
          [contextId]: {
            contextId,
            command: 'rdc',
            intermediateRoot: root,
            ownerPid: 91,
            daemonPid: 92,
            daemonBirth: '',
            workerPid: 0,
            workerBirth: '',
            startedAt: 1,
          },
        },
      }),
    );
    expect(() => listOwnedRdcDaemons({ registryPath })).toThrow(expect.objectContaining({ code: 'STORAGE_CORRUPT' }));
  });

  it('retires a proven dead registration without invoking an obsolete installation', async () => {
    const root = makeRoot();
    const registryPath = path.join(root, 'owned-rdc-daemons.json');
    rememberOwnedRdcDaemon(
      {
        contextId,
        command: 'retired',
        intermediateRoot: root,
        ownerPid: 91,
        ownerBirth: 'owner-birth',
        daemonPid: 92,
        daemonBirth: 'daemon-birth',
        workerPid: 0,
        workerBirth: '',
        startedAt: 1,
      },
      { registryPath },
    );
    const execute = vi.fn();
    const probe = vi.fn((_identity: ProcessIdentity): ProcessLiveness => 'exited');
    const result = await harvestOwnedRdcDaemons({ registryPath, intermediateRoot: root, probeProcess: probe, execute });
    expect(result).toEqual({ released: [contextId], failed: [], unconfirmed: [] });
    expect(probe).toHaveBeenCalledWith({ pid: 91, birth: 'owner-birth' });
    expect(probe).toHaveBeenCalledWith({ pid: 92, birth: 'daemon-birth' });
    expect(execute).not.toHaveBeenCalled();
    expect(listOwnedRdcDaemons({ registryPath })).toEqual([]);
  });

  it('never clears another live owner even when its endpoint file is absent', async () => {
    const root = makeRoot();
    const registryPath = path.join(root, 'owned-rdc-daemons.json');
    rememberOwnedRdcDaemon(
      {
        contextId,
        command: 'rdc',
        intermediateRoot: root,
        ownerPid: 91,
        ownerBirth: 'owner-birth',
        daemonPid: 92,
        daemonBirth: 'daemon-birth',
        workerPid: 0,
        workerBirth: '',
        startedAt: 1,
      },
      { registryPath },
    );
    const execute = vi.fn();
    const terminateProcess = vi.fn((): ProcessTermination => 'terminated');
    for (const liveness of ['alive', 'unknown'] as const) {
      const result = await harvestOwnedRdcDaemons({
        registryPath,
        intermediateRoot: root,
        probeProcess: () => liveness,
        execute,
        terminateProcess,
      });
      expect(result.failed[0].error).toContain('RDC_OWNERSHIP_BUSY');
    }
    expect(execute).not.toHaveBeenCalled();
    expect(terminateProcess).not.toHaveBeenCalled();
    expect(listOwnedRdcDaemons({ registryPath })).toHaveLength(1);
  });

  it('uses the recorded installation as a whole rather than the current CLI entry', async () => {
    const root = makeRoot();
    const registryPath = path.join(root, 'owned-rdc-daemons.json');
    const { python: command, entry } = rdcInstallationFiles(root);
    for (const file of [command, entry]) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'fixture');
    }
    rememberOwnedRdcDaemon(
      {
        contextId,
        command,
        intermediateRoot: root,
        ownerPid: process.pid,
        ownerBirth: '',
        daemonPid: 0,
        daemonBirth: '',
        workerPid: 0,
        workerBirth: '',
        startedAt: 1,
      },
      { registryPath },
    );
    const execute = vi.fn(async (verb: string) => ({
      exitCode: 0,
      stdout: JSON.stringify({
        ok: true,
        result_kind: verb === 'context' ? 'rdc_tool.context.clear' : 'rdc_tool.daemon.stop',
        data: { context_id: contextId, stopped: true },
      }),
      stderr: '',
      duration_ms: 1,
    }));
    const result = await harvestOwnedRdcDaemons({ registryPath, intermediateRoot: root, execute: execute as never });
    expect(result.failed).toEqual([]);
    const options = (
      execute.mock.calls[0] as unknown as [
        string,
        string[],
        { settings: { command: string; argsPrefix: string[]; workingDirectory: string } },
      ]
    )[2];
    expect(options.settings).toMatchObject({ command, argsPrefix: [entry], workingDirectory: root });
  });

  it('kills only command-line verified leftover pids when the recorded CLI is gone', async () => {
    const root = makeRoot();
    const registryPath = path.join(root, 'owned-rdc-daemons.json');
    rememberOwnedRdcDaemon(
      {
        contextId,
        command: path.join(root, 'missing-rdc-tool.exe'),
        intermediateRoot: path.join(root, 'rdc-tool-intermediate'),
        ownerPid: process.pid,
        ownerBirth: '',
        daemonPid: 91,
        daemonBirth: 'daemon-birth',
        workerPid: 92,
        workerBirth: 'worker-birth',
        startedAt: 1,
      },
      { registryPath },
    );
    const killed: ProcessIdentity[] = [];
    const result = await harvestOwnedRdcDaemons({
      registryPath,
      intermediateRoot: path.join(root, 'rdc-tool-intermediate'),
      probeProcess: () => 'alive',
      readCommandLine: (pid) =>
        pid === 91
          ? `python -m rdc_tool.daemon.server --daemon-context ${contextId}`
          : `python -m rdc_tool.runtime.worker_main --context-id ${contextId}`,
      terminateProcess: (identity) => {
        killed.push(identity);
        return 'terminated';
      },
    });
    expect(result.failed).toEqual([]);
    expect(killed).toEqual([
      { pid: 91, birth: 'daemon-birth' },
      { pid: 92, birth: 'worker-birth' },
    ]);
  });

  it('never kills a leftover pid whose identity or command line cannot be read', async () => {
    const root = makeRoot();
    const registryPath = path.join(root, 'owned-rdc-daemons.json');
    rememberOwnedRdcDaemon(
      {
        contextId,
        command: path.join(root, 'missing-rdc-tool.exe'),
        intermediateRoot: path.join(root, 'rdc-tool-intermediate'),
        ownerPid: process.pid,
        ownerBirth: '',
        daemonPid: 91,
        daemonBirth: 'daemon-birth',
        workerPid: 0,
        workerBirth: '',
        startedAt: 1,
      },
      { registryPath },
    );
    const terminateProcess = vi.fn((): ProcessTermination => 'terminated');
    for (const [liveness, commandLine] of [
      ['unknown', `rdc_tool.daemon.server ${contextId}`],
      ['alive', null],
    ] as const) {
      const result = await harvestOwnedRdcDaemons({
        registryPath,
        intermediateRoot: path.join(root, 'rdc-tool-intermediate'),
        probeProcess: (identity) => (identity.pid === 91 ? liveness : 'exited'),
        readCommandLine: () => commandLine,
        terminateProcess,
      });
      expect(result.failed).toEqual([expect.objectContaining({ error: expect.stringContaining('RDC_CLOSE_FAILED') })]);
    }
    expect(terminateProcess).not.toHaveBeenCalled();
    expect(listOwnedRdcDaemons({ registryPath })).toHaveLength(1);
  });

  it.skipIf(!process.env.RDC_NATIVE_TOOLS_ROOT)(
    'reaps a real refactored worker after its owner is unavailable',
    { timeout: 45_000 },
    async () => {
      const root = makeRoot();
      const registryPath = path.join(root, 'owned-rdc-daemons.json');
      const intermediateRoot = path.join(root, 'rdc-tool-intermediate');
      const installation = process.env.RDC_NATIVE_TOOLS_ROOT!;
      const { python } = rdcInstallationFiles(installation);
      const worker = spawn(python, ['-m', 'rdc_tool.runtime.worker_main', '--context-id', contextId], {
        cwd: installation,
        windowsHide: true,
        env: {
          ...process.env,
          RDC_TOOL_INTERMEDIATE_ROOT: intermediateRoot,
          RDC_TOOL_DAEMON_PID: '0',
          RDC_TOOL_DAEMON_BIRTH: '',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const exited = new Promise<void>((resolve) => {
        worker.once('exit', () => resolve());
        worker.once('error', () => resolve());
      });
      const waitForExit = () =>
        new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Worker did not exit')), 5_000);
          void exited.then(() => {
            clearTimeout(timer);
            resolve();
          });
        });
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Worker did not become ready')), 30_000);
          let output = '';
          worker.stdout.on('data', (chunk: Buffer) => {
            output += chunk.toString();
            if (output.includes('"kind": "ready"')) {
              clearTimeout(timer);
              resolve();
            }
          });
          worker.once('error', (error) => {
            clearTimeout(timer);
            reject(error);
          });
          worker.once('exit', () => {
            clearTimeout(timer);
            reject(new Error(`Worker exited before ready: ${output}`));
          });
          worker.stderr.resume();
        });
        expect(worker.pid).toBeGreaterThan(0);
        rememberOwnedRdcDaemon(
          {
            contextId,
            command: path.join(root, 'missing-rdc-tool.exe'),
            intermediateRoot,
            ownerPid: process.pid,
            ownerBirth: '',
            daemonPid: 0,
            daemonBirth: '',
            workerPid: worker.pid!,
            workerBirth: '',
            startedAt: 1,
          },
          { registryPath },
        );
        const result = await harvestOwnedRdcDaemons({ registryPath, intermediateRoot });
        expect(result.failed).toEqual([]);
        expect(result.released).toEqual([contextId]);
        await waitForExit();
        expect(listOwnedRdcDaemons({ registryPath })).toEqual([]);
      } finally {
        if (worker.exitCode === null && worker.signalCode === null) worker.kill();
        await waitForExit();
      }
    },
  );

  it('keeps the record when leftover pids are not a confirmed owned daemon', async () => {
    const root = makeRoot();
    const registryPath = path.join(root, 'owned-rdc-daemons.json');
    rememberOwnedRdcDaemon(
      {
        contextId,
        command: path.join(root, 'missing-rdc-tool.exe'),
        intermediateRoot: path.join(root, 'rdc-tool-intermediate'),
        ownerPid: process.pid,
        ownerBirth: '',
        daemonPid: 91,
        daemonBirth: 'daemon-birth',
        workerPid: 92,
        workerBirth: 'worker-birth',
        startedAt: 1,
      },
      { registryPath },
    );
    const killed: ProcessIdentity[] = [];
    const result = await harvestOwnedRdcDaemons({
      registryPath,
      intermediateRoot: path.join(root, 'rdc-tool-intermediate'),
      probeProcess: () => 'alive',
      readCommandLine: () => 'notepad.exe',
      terminateProcess: (identity) => {
        killed.push(identity);
        return 'terminated';
      },
    });
    expect(result.released).toEqual([]);
    expect(result.failed).toEqual([expect.objectContaining({ contextId })]);
    expect(killed).toEqual([]);
    expect(listOwnedRdcDaemons({ registryPath }).map((record) => record.contextId)).toEqual([contextId]);
  });
});
