import fs from 'fs';
import os from 'os';
import path from 'path';
import YAML from 'yaml';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CANONICAL_HOOK_EVENTS } from '@shared/types/rdxRuntime';
import { HookEngine } from './HookEngine';
import { CURRENT_HOOK_TRUST_SCHEMA_VERSION } from './hookTrustStore';

const roots: string[] = [];
const makeRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdx-hook-fp-'));
  roots.push(root);
  return root;
};
const emptyBuiltin = () => {
  const dir = path.join(makeRoot(), 'builtin');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

const nodeInline = (code: string) => ({
  command: process.execPath,
  args: ['-e', code],
  timeoutMs: 2000,
  failurePolicy: 'block' as const,
});

const writeHook = (dir: string, id: string, extra: Record<string, unknown>) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.hook.yml`), YAML.stringify({
    id,
    enabled: true,
    ...extra,
  }));
};

describe('HookEngine trust fingerprint', () => {
  it('dispatches all 12 canonical events on the single HookEngine path', async () => {
    expect(CANONICAL_HOOK_EVENTS).toHaveLength(12);
    const repoRoot = path.resolve(__dirname, '../../..');
    const dispatchSources = [
      'src/main/hooks/sessionLifecycle.ts',
      'src/main/hooks/runtimeHookDispatch.ts',
      'src/main/workflow/debugger/AgentTurnRunner.ts',
      'src/main/workflow/debugger/ToolExecutorFactory.ts',
      'src/main/workflow/debugger/RuntimeToolAssembly.ts',
      'src/main/agent-runtime/context/CompactionHandoffService.ts',
    ].map((relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8')).join('\n');
    for (const event of CANONICAL_HOOK_EVENTS) {
      expect(dispatchSources).toContain(`'${event}'`);
    }
    const root = makeRoot();
    const userHooks = path.join(root, 'user');
    for (const event of CANONICAL_HOOK_EVENTS) {
      writeHook(userHooks, event.replace(/[.]/g, '-'), {
        event,
        ...nodeInline('process.exit(0)'),
        failurePolicy: 'warn',
      });
    }
    const engine = new HookEngine(path.join(root, 'trust.json'));
    const loaded = engine.load(userHooks, undefined, emptyBuiltin());
    expect(loaded).toHaveLength(12);
    for (const hook of loaded) engine.trustUserHook(hook.definition.id);
    for (const event of CANONICAL_HOOK_EVENTS) {
      const result = await engine.trigger(event, { event });
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ status: 'completed', allowed: true, hookId: event.replace(/[.]/g, '-') });
    }
  });

  it('isolates unexpected hook exceptions and honors cancel timeout policy', async () => {
    const root = makeRoot();
    const userHooks = path.join(root, 'user');
    writeHook(userHooks, 'first', {
      event: 'turn.after-end',
      ...nodeInline('setTimeout(()=>{}, 5000)'),
      timeoutMs: 20,
      failurePolicy: 'warn',
    });
    writeHook(userHooks, 'second', {
      event: 'turn.after-end',
      ...nodeInline('console.log("second")'),
      failurePolicy: 'warn',
    });
    const engine = new HookEngine(path.join(root, 'trust.json'));
    engine.load(userHooks, undefined, emptyBuiltin());
    engine.trustUserHook('first');
    engine.trustUserHook('second');
    const warned = await engine.trigger('turn.after-end', { event: 'turn.after-end' });
    expect(warned.map((entry) => entry.hookId)).toEqual(['first', 'second']);
    expect(warned[0].status).toBe('timed-out');
    expect(warned[1].status).toBe('completed');

    const isolated = new HookEngine(path.join(root, 'trust-iso.json'));
    isolated.load(userHooks, undefined, emptyBuiltin());
    isolated.trustUserHook('first');
    isolated.trustUserHook('second');
    const run = vi.spyOn(isolated as unknown as { run: (...args: unknown[]) => Promise<unknown> }, 'run');
    run.mockRejectedValueOnce(new Error('boom'));
    const isolatedResult = await isolated.trigger('turn.after-end', { event: 'turn.after-end' });
    expect(isolatedResult[0]).toMatchObject({ hookId: 'first', status: 'failed', allowed: true, reason: 'boom' });
    expect(isolatedResult[1]).toMatchObject({ hookId: 'second', status: 'completed' });
    run.mockRestore();
  });

  it('keeps trust across restart and revokes explicit trust', () => {
    const root = makeRoot();
    const project = path.join(root, 'project');
    const hooks = path.join(project, '.rdx', 'hooks');
    writeHook(hooks, 'check', { event: 'tool.after-call', ...nodeInline('process.exit(0)') });
    const trustPath = path.join(root, 'trust.json');
    const first = new HookEngine(trustPath);
    first.load(path.join(root, 'user'), project, emptyBuiltin());
    first.trustProjectHook(project, 'check');
    const restarted = new HookEngine(trustPath);
    expect(restarted.load(path.join(root, 'user'), project, emptyBuiltin())[0].trust.trusted).toBe(true);
    restarted.revokeProjectHook(project, 'check');
    expect(restarted.list()[0].trust).toMatchObject({ trusted: false, needsRetrust: true });
    const afterRevoke = new HookEngine(trustPath);
    expect(afterRevoke.load(path.join(root, 'user'), project, emptyBuiltin())[0].trust.trusted).toBe(false);
  });

  it('does not accept an old YAML-only sourceHash even when it matches the parsed definition', () => {
    const root = makeRoot();
    const project = path.join(root, 'project');
    const hooks = path.join(project, '.rdx', 'hooks');
    writeHook(hooks, 'check', { event: 'permission.denied', ...nodeInline('process.exit(0)') });
    const trustPath = path.join(root, 'trust.json');
    const engine = new HookEngine(trustPath);
    const loaded = engine.load(path.join(root, 'user'), project, emptyBuiltin());
    fs.writeFileSync(trustPath, JSON.stringify({
      [`${path.resolve(project).toLowerCase()}::check`]: {
        sourceHash: loaded[0].sourceHash,
        trustedAt: '2026-01-01T00:00:00.000Z',
      },
    }));
    const reloaded = engine.load(path.join(root, 'user'), project, emptyBuiltin());
    expect(reloaded[0].trust.trusted).toBe(false);
    expect(reloaded[0].trust.needsRetrust).toBe(true);
    const persisted = JSON.parse(fs.readFileSync(trustPath, 'utf8')) as { schemaVersion: string; records: unknown };
    expect(persisted.schemaVersion).toBe(CURRENT_HOOK_TRUST_SCHEMA_VERSION);
    expect(persisted.records).toEqual({});
    expect(JSON.stringify(persisted)).not.toContain(loaded[0].sourceHash);
  });

  it('requires retrust when referenced script bytes change', () => {
    const root = makeRoot();
    const project = path.join(root, 'project');
    const hooks = path.join(project, '.rdx', 'hooks');
    fs.mkdirSync(hooks, { recursive: true });
    const script = path.join(hooks, 'run.mjs');
    fs.writeFileSync(script, 'process.exit(0)\n');
    writeHook(hooks, 'check', {
      event: 'context.before-compact',
      command: process.execPath,
      args: ['run.mjs'],
      timeoutMs: 2000,
      failurePolicy: 'block',
    });
    const engine = new HookEngine(path.join(root, 'trust.json'));
    engine.load(path.join(root, 'user'), project, emptyBuiltin());
    engine.trustProjectHook(project, 'check');
    const previous = fs.statSync(script);
    fs.writeFileSync(script, 'process.exit(1)\n');
    fs.utimesSync(script, previous.atime, previous.mtime);
    const reloaded = engine.load(path.join(root, 'user'), project, emptyBuiltin());
    expect(reloaded[0].trust.trusted).toBe(false);
    expect(reloaded[0].trust.needsRetrust).toBe(true);
    expect(reloaded[0].trustFingerprint).not.toBe(reloaded[0].sourceHash);
  });

  it('requires retrust when an extensionless relative script changes', () => {
    const root = makeRoot();
    const project = path.join(root, 'project');
    const hooks = path.join(project, '.rdx', 'hooks');
    fs.mkdirSync(hooks, { recursive: true });
    const script = path.join(hooks, 'run');
    fs.writeFileSync(script, 'process.exit(0)\n');
    writeHook(hooks, 'check', {
      event: 'context.before-compact',
      command: process.execPath,
      args: ['run'],
      timeoutMs: 2000,
      failurePolicy: 'block',
    });
    const engine = new HookEngine(path.join(root, 'trust.json'));
    engine.load(path.join(root, 'user'), project, emptyBuiltin());
    engine.trustProjectHook(project, 'check');
    const previous = fs.statSync(script);
    fs.writeFileSync(script, 'process.exit(1)\n');
    fs.utimesSync(script, previous.atime, previous.mtime);
    const reloaded = engine.load(path.join(root, 'user'), project, emptyBuiltin());
    expect(reloaded[0].trust.trusted).toBe(false);
    expect(reloaded[0].trust.needsRetrust).toBe(true);
  });

  it('does not untrust project B when revoking the same hook id in project A', () => {
    const root = makeRoot();
    const projectA = path.join(root, 'project-a');
    const projectB = path.join(root, 'project-b');
    const hooksA = path.join(projectA, '.rdx', 'hooks');
    const hooksB = path.join(projectB, '.rdx', 'hooks');
    const userHooks = path.join(root, 'user');
    writeHook(hooksA, 'check', { event: 'tool.after-call', ...nodeInline('process.exit(0)') });
    writeHook(hooksB, 'check', { event: 'tool.after-call', ...nodeInline('process.exit(0)') });
    const engine = new HookEngine(path.join(root, 'trust.json'));
    const builtin = emptyBuiltin();
    engine.load(userHooks, projectA, builtin);
    engine.trustProjectHook(projectA, 'check');
    engine.load(userHooks, projectB, builtin);
    engine.trustProjectHook(projectB, 'check');
    engine.load(userHooks, projectB, builtin);
    engine.revokeHook('check', projectA);
    expect(engine.load(userHooks, projectB, builtin)[0].trust.trusted).toBe(true);
    expect(engine.load(userHooks, projectA, builtin)[0].trust.trusted).toBe(false);
    engine.trustProjectHook(projectA, 'check');
    engine.revokeHook('check');
    expect(engine.load(userHooks, projectA, builtin)[0].trust.trusted).toBe(true);
    expect(engine.load(userHooks, projectB, builtin)[0].trust.trusted).toBe(true);
  });

  it('requires retrust when the same basename resolves to a different PATH executable', () => {
    const root = makeRoot();
    const project = path.join(root, 'project');
    const hooks = path.join(project, '.rdx', 'hooks');
    const dirA = path.join(root, 'bin-a');
    const dirB = path.join(root, 'bin-b');
    fs.mkdirSync(dirA, { recursive: true });
    fs.mkdirSync(dirB, { recursive: true });
    const toolName = process.platform === 'win32' ? 'rdx-hook-probe.cmd' : 'rdx-hook-probe';
    fs.writeFileSync(path.join(dirA, toolName), process.platform === 'win32' ? '@echo a\r\n' : '#!/bin/sh\necho a\n');
    fs.writeFileSync(path.join(dirB, toolName), process.platform === 'win32' ? '@echo b\r\n' : '#!/bin/sh\necho b\n');
    if (process.platform !== 'win32') {
      fs.chmodSync(path.join(dirA, toolName), 0o755);
      fs.chmodSync(path.join(dirB, toolName), 0o755);
    }
    writeHook(hooks, 'check', {
      event: 'context.after-compact',
      command: toolName,
      args: [],
      timeoutMs: 2000,
      failurePolicy: 'warn',
    });
    const previousPath = process.env.PATH;
    try {
      process.env.PATH = `${dirA}${path.delimiter}${previousPath ?? ''}`;
      const engine = new HookEngine(path.join(root, 'trust.json'));
      engine.load(path.join(root, 'user'), project, emptyBuiltin());
      engine.trustProjectHook(project, 'check');
      const trusted = engine.list()[0].trustFingerprint;
      process.env.PATH = `${dirB}${path.delimiter}${previousPath ?? ''}`;
      const reloaded = engine.load(path.join(root, 'user'), project, emptyBuiltin());
      expect(reloaded[0].trustFingerprint).not.toBe(trusted);
      expect(reloaded[0].trust.trusted).toBe(false);
      expect(reloaded[0].trust.needsRetrust).toBe(true);
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  });

  it('requires retrust when symlink realpath changes with identical bytes', () => {
    const root = makeRoot();
    const project = path.join(root, 'project');
    const hooks = path.join(project, '.rdx', 'hooks');
    const targetA = path.join(root, 'target-a');
    const targetB = path.join(root, 'target-b');
    const linkDir = path.join(hooks, 'scripts');
    fs.mkdirSync(hooks, { recursive: true });
    fs.mkdirSync(targetA, { recursive: true });
    fs.mkdirSync(targetB, { recursive: true });
    fs.writeFileSync(path.join(targetA, 'run.mjs'), 'process.exit(0)\n');
    fs.writeFileSync(path.join(targetB, 'run.mjs'), 'process.exit(0)\n');
    try {
      fs.symlinkSync(targetA, linkDir, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      expect(error).toBeTruthy();
      return;
    }
    writeHook(hooks, 'check', {
      event: 'session.after-end',
      command: process.execPath,
      args: [path.join('scripts', 'run.mjs')],
      timeoutMs: 2000,
      failurePolicy: 'block',
    });
    const engine = new HookEngine(path.join(root, 'trust.json'));
    engine.load(path.join(root, 'user'), project, emptyBuiltin());
    engine.trustProjectHook(project, 'check');
    fs.rmSync(linkDir, { recursive: true, force: true });
    fs.symlinkSync(targetB, linkDir, process.platform === 'win32' ? 'junction' : 'dir');
    const reloaded = engine.load(path.join(root, 'user'), project, emptyBuiltin());
    expect(reloaded[0].trust.trusted).toBe(false);
    expect(reloaded[0].trust.needsRetrust).toBe(true);
  });

  it('requires retrust when command resolution changes', () => {
    const root = makeRoot();
    const project = path.join(root, 'project');
    const hooks = path.join(project, '.rdx', 'hooks');
    const toolA = path.join(root, process.platform === 'win32' ? 'tool-a.cmd' : 'tool-a');
    const toolB = path.join(root, process.platform === 'win32' ? 'tool-b.cmd' : 'tool-b');
    fs.writeFileSync(toolA, process.platform === 'win32' ? '@echo a\r\n' : '#!/bin/sh\necho a\n');
    fs.writeFileSync(toolB, process.platform === 'win32' ? '@echo b\r\n' : '#!/bin/sh\necho b\n');
    writeHook(hooks, 'check', {
      event: 'agent.after-handoff',
      command: toolA,
      args: [],
      timeoutMs: 2000,
      failurePolicy: 'warn',
    });
    const engine = new HookEngine(path.join(root, 'trust.json'));
    engine.load(path.join(root, 'user'), project, emptyBuiltin());
    engine.trustProjectHook(project, 'check');
    writeHook(hooks, 'check', {
      event: 'agent.after-handoff',
      command: toolB,
      args: [],
      timeoutMs: 2000,
      failurePolicy: 'warn',
    });
    const reloaded = engine.load(path.join(root, 'user'), project, emptyBuiltin());
    expect(reloaded[0].trust.trusted).toBe(false);
    expect(reloaded[0].trust.needsRetrust).toBe(true);
  });
});
