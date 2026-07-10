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
