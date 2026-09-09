import fs from 'fs';
import os from 'os';
import path from 'path';
import YAML from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';
import { HookEngine } from './HookEngine';

const roots: string[] = [];
const makeRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdx-hooks-'));
  roots.push(root);
  return root;
};
const emptyBuiltin = () => {
  const dir = path.join(makeRoot(), 'builtin');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

describe('HookEngine', { timeout: 20_000 }, () => {
  it('requires content-hash trust for project hooks and revokes on change', async () => {
    const root = makeRoot();
    const project = path.join(root, 'project');
    const hooks = path.join(project, '.rdx', 'hooks');
    fs.mkdirSync(hooks, { recursive: true });
    const source = path.join(hooks, 'check.hook.yml');
    const definition = {
      id: 'check', enabled: true, event: 'tool.before-call', command: process.execPath,
      args: ['-e', 'process.stdin.resume(); process.stdin.on("end",()=>{console.log("ok")})'],
      timeoutMs: 2000, failurePolicy: 'block', matcher: { tools: ['read_file'] },
    };
    fs.writeFileSync(source, YAML.stringify(definition));
    const engine = new HookEngine(path.join(root, 'trust.json'));
    const isolatedBuiltin = emptyBuiltin();
    engine.load(path.join(root, 'user-hooks'), project, isolatedBuiltin);
    expect((await engine.trigger('tool.before-call', { event: 'tool.before-call', projectRoot: project, toolName: 'read_file' }))[0].status).toBe('untrusted');
    engine.trustProjectHook(project, 'check');
    expect((await engine.trigger('tool.before-call', { event: 'tool.before-call', projectRoot: project, toolName: 'read_file' }))[0]).toMatchObject({ status: 'completed', allowed: true });
    fs.writeFileSync(source, YAML.stringify({ ...definition, args: ['-e', 'process.exit(0)'] }));
    expect(engine.load(path.join(root, 'user-hooks'), project, isolatedBuiltin)[0].trust.trusted).toBe(false);
  });

  it('resolves builtin < user < project with the same ScopedResourceResolver order', async () => {
    const root = makeRoot();
    const builtin = path.join(root, 'builtin');
    const userHooks = path.join(root, 'user');
    const project = path.join(root, 'project');
    const projectHooks = path.join(project, '.rdx', 'hooks');
    fs.mkdirSync(builtin, { recursive: true });
    fs.mkdirSync(userHooks, { recursive: true });
    fs.mkdirSync(projectHooks, { recursive: true });
    const writeHook = (dir: string, commandArg: string) => {
      fs.writeFileSync(path.join(dir, 'audit.hook.yml'), YAML.stringify({
        id: 'audit',
        enabled: true,
        event: 'session.before-start',
        command: process.execPath,
        args: ['-e', `console.log(${JSON.stringify(commandArg)})`],
        timeoutMs: 2000,
        failurePolicy: 'warn',
      }));
    };
    writeHook(builtin, 'builtin');
    writeHook(userHooks, 'user');
    const engine = new HookEngine(path.join(root, 'trust.json'));
    const builtinWinner = engine.load(userHooks, undefined, builtin);
    expect(builtinWinner).toHaveLength(1);
    expect(builtinWinner[0].scope).toBe('user');
    expect(builtinWinner[0].trust.trusted).toBe(false);
    expect(builtinWinner[0].trust.needsRetrust).toBe(true);
    engine.trustUserHook('audit');
    expect(engine.list()[0].trust.trusted).toBe(true);
    writeHook(projectHooks, 'project');
    const projectLoaded = engine.load(userHooks, project, builtin);
    expect(projectLoaded[0].scope).toBe('project');
    expect(projectLoaded[0].trust.trusted).toBe(false);
    engine.trustProjectHook(project, 'audit');
    const result = await engine.trigger('session.before-start', {
      event: 'session.before-start',
      projectRoot: project,
    });
    expect(result[0]).toMatchObject({ status: 'completed', allowed: true });
    expect(result[0].stdout.trim()).toBe('project');
  });

  it('keeps the user trust record when revokeHook receives a projectRoot', () => {
    const root = makeRoot();
    const userHooks = path.join(root, 'user');
    const project = path.join(root, 'project');
    fs.mkdirSync(userHooks, { recursive: true });
    fs.writeFileSync(path.join(userHooks, 'audit.hook.yml'), YAML.stringify({
      id: 'audit',
      enabled: true,
      event: 'session.before-start',
      command: process.execPath,
      args: ['-e', 'console.log("user")'],
      timeoutMs: 2000,
      failurePolicy: 'warn',
    }));
    const engine = new HookEngine(path.join(root, 'trust.json'));
    const builtin = emptyBuiltin();
    engine.load(userHooks, undefined, builtin);
    engine.trustUserHook('audit');
    expect(engine.list()[0].trust.trusted).toBe(true);
    engine.revokeHook('audit', project);
    expect(engine.load(userHooks, undefined, builtin)[0].trust.trusted).toBe(true);
    engine.revokeHook('audit');
    expect(engine.load(userHooks, undefined, builtin)[0].trust.trusted).toBe(false);
  });

  it('parses and runs the four builtin Wave 4 hook templates', async () => {
    const repoRoot = path.resolve(__dirname, '../../..');
    const builtin = path.join(repoRoot, 'resources', 'agent-runtime', 'hooks');
    const engine = new HookEngine(path.join(makeRoot(), 'trust.json'));
    const loaded = engine.load(path.join(makeRoot(), 'user-hooks'), undefined, builtin)
      .filter((hook) => ['mission-plan-handoff-check', 'rdx-shell-audit', 'artifact-integrity', 'report-contract']
        .includes(hook.definition.id));
    expect(loaded.map((hook) => hook.definition.id).sort()).toEqual([
      'artifact-integrity',
      'mission-plan-handoff-check',
      'rdx-shell-audit',
      'report-contract',
    ]);
    expect(loaded.every((hook) => hook.scope === 'builtin' && hook.trust.trusted)).toBe(true);
    expect(loaded.map((hook) => hook.definition.event)).toEqual(expect.arrayContaining([
      'agent.before-handoff',
      'tool.before-call',
    ]));

    const handoff = await engine.test('mission-plan-handoff-check', {
      event: 'agent.before-handoff',
      agentId: 'debugger',
      sessionId: 'session-a',
      payload: {
        fromAgentId: 'debugger',
        toAgentId: 'general',
        label: 'Execute with General',
        prompt: 'Execute the approved plan.',
        depth: 1,
        isBigLoop: false,
      },
    });
    expect(handoff).toMatchObject({ status: 'completed', allowed: true });

    const initialMission = await engine.test('mission-plan-handoff-check', {
      event: 'agent.before-handoff',
      agentId: 'general',
      sessionId: 'session-a',
      payload: {
        fromAgentId: 'general',
        toAgentId: 'debugger',
        label: 'Debug with Debugger',
        prompt: 'Investigate the current failure.',
        depth: 1,
        isBigLoop: false,
      },
    });
    expect(initialMission).toMatchObject({ status: 'completed', allowed: true });

    const bigLoopMissing = await engine.test('mission-plan-handoff-check', {
      event: 'agent.before-handoff',
      agentId: 'general',
      sessionId: 'session-a',
      payload: {
        fromAgentId: 'general',
        toAgentId: 'debugger',
        label: 'Replan with Debugger',
        prompt: 'Replan the mission.',
        depth: 2,
        isBigLoop: true,
      },
    });
    expect(bigLoopMissing.status).toBe('failed');
    expect(bigLoopMissing.allowed).toBe(false);

    const bigLoopOk = await engine.test('mission-plan-handoff-check', {
      event: 'agent.before-handoff',
      agentId: 'general',
      sessionId: 'session-a',
      payload: {
        fromAgentId: 'general',
        toAgentId: 'debugger',
        label: 'Replan with Debugger',
        prompt: 'Replan from the persisted MissionCheckpoint.',
        depth: 2,
        isBigLoop: true,
        checkpointId: 'cp-1',
      },
    });
    expect(bigLoopOk).toMatchObject({ status: 'completed', allowed: true });

    const secondEvaluation = await engine.test('mission-plan-handoff-check', {
      event: 'agent.before-handoff',
      agentId: 'general',
      sessionId: 'session-a',
      payload: {
        fromAgentId: 'general',
        toAgentId: 'debugger',
        label: 'Replan with Debugger',
        prompt: 'Replan from the persisted MissionCheckpoint.',
        depth: 4,
        isBigLoop: true,
        checkpointId: 'cp-1',
      },
    });
    expect(secondEvaluation).toMatchObject({ status: 'completed', allowed: true }); // Main owns cycle counting; the second return remains available.

    const readyDenied = await engine.test('artifact-integrity', {
      event: 'tool.before-call',
      toolName: 'investigation_write',
      payload: { toolName: 'investigation_write', arguments: { status: 'ready', sourceRefs: [] } },
    });
    expect(readyDenied.status).toBe('failed');
    expect(readyDenied.allowed).toBe(false);

    const upgraded = await engine.test('report-contract', {
      event: 'tool.before-call',
      toolName: 'investigation_write',
      payload: {
        toolName: 'investigation_write',
        arguments: {
          kind: 'report',
          record: {
            projectionKind: 'report',
            claimId: 'c1',
            epistemic: 'observed',
            compactProvenance: [{ sourceClaimId: 'c0', sourceEpistemicStatus: 'inferred', sourceVerificationLevel: 'reconstructed' }],
          },
        },
      },
    });
    expect(upgraded.status).toBe('failed');
    expect(upgraded.allowed).toBe(false);
  });

  it('refuses a builtin hook when the official script is missing and project cwd has the same relative path', async () => {
    const root = makeRoot();
    const builtin = path.join(root, 'builtin');
    const project = path.join(root, 'project');
    fs.mkdirSync(builtin, { recursive: true });
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(path.join(builtin, 'trap.hook.yml'), YAML.stringify({
      id: 'trap',
      enabled: true,
      event: 'tool.before-call',
      command: process.execPath,
      args: ['trap.mjs'],
      timeoutMs: 2000,
      failurePolicy: 'block',
    }));
    fs.writeFileSync(path.join(project, 'trap.mjs'), [
      'process.stdout.write("HIJACKED\\n");',
      'process.exit(0);',
      '',
    ].join('\n'));
    const engine = new HookEngine(path.join(root, 'trust.json'));
    engine.load(path.join(root, 'user-hooks'), project, builtin);
    const result = await engine.test('trap', {
      event: 'tool.before-call',
      projectRoot: project,
    });
    expect(result.status).not.toBe('completed');
    expect(['failed', 'untrusted']).toContain(result.status);
    expect(result.allowed).toBe(false);
    expect(result.stdout).not.toContain('HIJACKED');
    expect(result.reason).toMatch(/official hook directory|not found|unresolved/i);
  });

  it('does not execute a project scripts/hooks twin when running a builtin hook', async () => {
    const repoRoot = path.resolve(__dirname, '../../..');
    const builtin = path.join(repoRoot, 'resources', 'agent-runtime', 'hooks');
    const project = path.join(makeRoot(), 'project');
    const hijackDir = path.join(project, 'scripts', 'hooks');
    fs.mkdirSync(hijackDir, { recursive: true });
    const hijackSource = [
      'process.stdout.write("HIJACKED\\n");',
      'process.exit(0);',
      '',
    ].join('\n');
    for (const name of ['artifact-integrity.mjs', 'report-contract.mjs', 'rdx-shell-audit.mjs', 'mission-plan-handoff-check.mjs']) {
      fs.writeFileSync(path.join(hijackDir, name), hijackSource);
      fs.writeFileSync(path.join(project, name), hijackSource);
    }
    const engine = new HookEngine(path.join(makeRoot(), 'trust.json'));
    engine.load(path.join(makeRoot(), 'user-hooks'), project, builtin);
    const readyDenied = await engine.test('artifact-integrity', {
      event: 'tool.before-call',
      toolName: 'investigation_write',
      projectRoot: project,
      payload: { toolName: 'investigation_write', arguments: { status: 'ready', sourceRefs: [] } },
    });
    expect(readyDenied.status).toBe('failed');
    expect(readyDenied.allowed).toBe(false);
    expect(readyDenied.stdout).not.toContain('HIJACKED');
    expect(readyDenied.stderr).toMatch(/sourceRefs/);
  });

  it('audits renderdoccmd with arguments and ignores Settings RDX action names', async () => {
    const repoRoot = path.resolve(__dirname, '../../..');
    const builtin = path.join(repoRoot, 'resources', 'agent-runtime', 'hooks');
    const engine = new HookEngine(path.join(makeRoot(), 'trust.json'));
    engine.load(path.join(makeRoot(), 'user-hooks'), makeRoot(), builtin);

    const hardcoded = await engine.test('rdx-shell-audit', {
      event: 'tool.before-call',
      toolName: 'shell',
      payload: { toolName: 'shell', arguments: { command: 'renderdoccmd capture.rdc' } },
    });
    expect(hardcoded.status).toBe('failed');
    expect(hardcoded.allowed).toBe(true);
    expect(hardcoded.stderr).toMatch(/hardcoded RenderDoc\/RDX CLI/);

    const settingsAction = await engine.test('rdx-shell-audit', {
      event: 'tool.before-call',
      toolName: 'shell',
      payload: { toolName: 'shell', arguments: { command: 'openCapture' } },
    });
    expect(settingsAction).toMatchObject({ status: 'completed', allowed: true });
    expect(settingsAction.stdout).toMatch(/rdx-shell-audit: ok/);
  });

  it('does not keep AgentHooks or BackgroundTaskRunner as a second surface', () => {
    const repoRoot = path.resolve(__dirname, '../../..');
    expect(fs.existsSync(path.join(repoRoot, 'src/main/agent-runtime/agent/AgentHooks.ts'))).toBe(false);
    expect(fs.existsSync(path.join(repoRoot, 'src/main/agent-runtime/agent/HookCallbacks.ts'))).toBe(false);
    expect(fs.existsSync(path.join(repoRoot, 'src/main/agent-runtime/scheduler/BackgroundTaskRunner.ts'))).toBe(false);
  });

  it('applies explicit warn or block timeout policy without shell execution', async () => {
    const root = makeRoot();
    const userHooks = path.join(root, 'hooks');
    fs.mkdirSync(userHooks);
    fs.writeFileSync(path.join(userHooks, 'timeout.hook.yml'), YAML.stringify({
      id: 'timeout', enabled: true, event: 'turn.before-start', command: process.execPath,
      args: ['-e', 'setTimeout(()=>{}, 5000)'], timeoutMs: 20, failurePolicy: 'warn',
    }));
    const engine = new HookEngine(path.join(root, 'trust.json'));
    engine.load(userHooks, undefined, emptyBuiltin());
    engine.trustUserHook('timeout');
    expect((await engine.trigger('turn.before-start', { event: 'turn.before-start' }))[0]).toMatchObject({ status: 'timed-out', allowed: true });
  });
});
