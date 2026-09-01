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
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

describe('HookEngine', () => {
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
    engine.load(path.join(root, 'user-hooks'), project);
    expect((await engine.trigger('tool.before-call', { event: 'tool.before-call', projectRoot: project, toolName: 'read_file' }))[0].status).toBe('untrusted');
    engine.trustProjectHook(project, 'check');
    expect((await engine.trigger('tool.before-call', { event: 'tool.before-call', projectRoot: project, toolName: 'read_file' }))[0]).toMatchObject({ status: 'completed', allowed: true });
    fs.writeFileSync(source, YAML.stringify({ ...definition, args: ['-e', 'process.exit(0)'] }));
    expect(engine.load(path.join(root, 'user-hooks'), project)[0].trust.trusted).toBe(false);
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
    expect(builtinWinner[0].trust.trusted).toBe(true);
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
    engine.load(userHooks);
    expect((await engine.trigger('turn.before-start', { event: 'turn.before-start' }))[0]).toMatchObject({ status: 'timed-out', allowed: true });
  });
});
