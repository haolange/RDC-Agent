import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ratchetCli = path.join(repoRoot, 'scripts', 'system-debt-ratchet.mjs');
const knowledgeCli = path.join(repoRoot, 'scripts', 'check-knowledge-system.mjs');
const investigationCli = path.join(repoRoot, 'scripts', 'check-investigation-system.mjs');
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function spawnNode(script: string, args: string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv }): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: options?.cwd ?? repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...options?.env },
    windowsHide: true,
  });
}

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'rdc-system-debt-test-'));
  tempRoots.push(dir);
  return dir;
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function fixtureRegistry() {
  return [
    {
      id: 'demo.missing.target',
      kind: 'missing',
      file: 'src/target.ts',
      pattern: 'export const ready = true',
      probe: 'source-pattern',
      note: 'fixture target',
    },
    {
      id: 'demo.forbidden.legacy',
      kind: 'forbidden',
      file: 'src/legacy.ts',
      pattern: 'LEGACY_MARK',
      probe: 'source-pattern',
      note: 'fixture legacy',
    },
  ];
}

function debtDoc(ids: string[], maxHits = ids.length) {
  return {
    schemaVersion: 1,
    waveClearBy: 6,
    maxHits,
    ids: [...ids].sort((left, right) => left.localeCompare(right)),
  };
}

function git(repo: string, args: string[]): string {
  const result = spawnSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    windowsHide: true,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'ratchet-test',
      GIT_AUTHOR_EMAIL: 'ratchet@example.test',
      GIT_COMMITTER_NAME: 'ratchet-test',
      GIT_COMMITTER_EMAIL: 'ratchet@example.test',
    },
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function runFixture(dir: string, extraArgs: string[] = [], env: NodeJS.ProcessEnv = {}) {
  return spawnNode(ratchetCli, [
    '--name',
    'fixture',
    '--repo-root',
    dir,
    '--debt-file',
    path.join(dir, 'debt.json'),
    '--registry-file',
    path.join(dir, 'registry.json'),
    '--skip-hard-forbids',
    ...extraArgs,
  ], { cwd: dir, env: { CI: '', ...env } });
}

describe('system debt ratchet CLI', () => {
  it('passes --self-test fixture matrix', () => {
    const result = spawnNode(ratchetCli, ['--self-test']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('exact: ok');
    expect(result.stdout).toContain('new-id: ok');
    expect(result.stdout).toContain('stale: ok');
    expect(result.stdout).toContain('maxHits: ok');
    expect(result.stdout).toContain('posix: ok');
    expect(result.stdout).toContain('base-init: ok');
    expect(result.stdout).toContain('base-new-id-forbidden: ok');
    expect(result.stdout).toContain('debt-extra-keys: ok');
    expect(result.stdout).toContain('contract-substring: ok');
    expect(result.stdout).toContain('contract-assertions-zero: ok');
    expect(result.stdout).toContain('contract-no-assert: ok');
    expect(result.stdout).toContain('contract-skip: ok');
    expect(result.stdout).toContain('contract-missing-case: ok');
    expect(result.stdout).toContain('contract-comment-spoof: ok');
    expect(result.stdout).toContain('contract-duplicate-title: ok');
    expect(result.stdout).toContain('contract-expression-body: ok');
    expect(result.stdout).toContain('contract-non-literal-callback: ok');
    expect(result.stdout).toContain('contract-if-false-guard: ok');
    expect(result.stdout).toContain('contract-return-then-guard: ok');
    expect(result.stdout).toContain('contract-hasassertions-only-runtime: ok');
    expect(result.stdout).toContain('vitest-json-substring: ok');
    expect(result.stdout).toContain('profile-ceiling: ok');
    expect(result.stdout).toContain('hard-taskstore-rename: ok');
    expect(result.stdout).toContain('hard-taskstore-type-ref: ok');
    expect(result.stdout).toContain('hard-rdx-settings-mcp: ok');
    expect(result.stdout).toContain('hard-rdx-plain-name: ok');
    expect(result.stdout).toContain('hard-rdx-agent-tool: ok');
    expect(result.stdout).toContain('hard-knowledge-write-token: ok');
    expect(result.stdout).toContain('hard-knowledge-write-canonical-lifecycle: ok');
    expect(result.stdout).toContain('hard-knowledge-write-canonical-tool: ok');
    expect(result.stdout).toContain('hard-knowledge-write-canonical-clean: ok');
    expect(result.stdout).toContain('hard-knowledge-lifecycle: ok');
  });

  it('fails a new measured id that is not in debt', () => {
    const dir = tempDir();
    mkdirSync(path.join(dir, 'src'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'legacy.ts'), 'export const LEGACY_MARK = 1;\n', 'utf8');
    writeJson(path.join(dir, 'registry.json'), fixtureRegistry());
    writeJson(path.join(dir, 'debt.json'), debtDoc(['demo.forbidden.legacy']));
    const result = runFixture(dir);
    expect(result.status).not.toBe(0);
    expect(`${result.stderr}${result.stdout}`).toMatch(/new hit|demo\.missing\.target/);
  });

  it('fails a stale debt id that is no longer a hit', () => {
    const dir = tempDir();
    mkdirSync(path.join(dir, 'src'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'legacy.ts'), 'export const LEGACY_MARK = 1;\n', 'utf8');
    writeFileSync(path.join(dir, 'src', 'target.ts'), 'export const ready = true;\n', 'utf8');
    writeJson(path.join(dir, 'registry.json'), fixtureRegistry());
    writeJson(path.join(dir, 'debt.json'), debtDoc(['demo.forbidden.legacy', 'demo.missing.target']));
    const result = runFixture(dir);
    expect(result.status).not.toBe(0);
    expect(`${result.stderr}${result.stdout}`).toMatch(/stale debt id/);
  });

  it('fails when maxHits does not equal ids.length', () => {
    const dir = tempDir();
    mkdirSync(path.join(dir, 'src'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'legacy.ts'), 'export const LEGACY_MARK = 1;\n', 'utf8');
    writeJson(path.join(dir, 'registry.json'), fixtureRegistry());
    writeJson(path.join(dir, 'debt.json'), debtDoc(['demo.forbidden.legacy', 'demo.missing.target'], 3));
    const result = runFixture(dir);
    expect(result.status).not.toBe(0);
    expect(`${result.stderr}${result.stdout}`).toMatch(/maxHits|ids\.length/);
  });

  it('accepts an exact registry↔debt match and reports posix paths', () => {
    const dir = tempDir();
    mkdirSync(path.join(dir, 'src'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'legacy.ts'), 'export const LEGACY_MARK = 1;\n', 'utf8');
    writeJson(path.join(dir, 'registry.json'), fixtureRegistry());
    writeJson(path.join(dir, 'debt.json'), debtDoc(['demo.forbidden.legacy', 'demo.missing.target']));
    const result = runFixture(dir);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(`${result.stdout}${result.stderr}`).not.toMatch(/\\src\\/);
  });

  it('allows Wave0 initialization when the base commit has no debt file', () => {
    const dir = tempDir();
    mkdirSync(path.join(dir, 'src'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'legacy.ts'), 'export const LEGACY_MARK = 1;\n', 'utf8');
    writeJson(path.join(dir, 'registry.json'), fixtureRegistry());
    writeJson(path.join(dir, 'debt.json'), debtDoc(['demo.forbidden.legacy', 'demo.missing.target']));
    git(dir, ['init']);
    git(dir, ['add', 'src/legacy.ts']);
    git(dir, ['commit', '-m', 'base without debt']);
    const base = git(dir, ['rev-parse', 'HEAD']);
    const result = runFixture(dir, ['--base-ref', base], { CI: 'true' });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/Wave0 initialization/i);
  });

  it('forbids adding a debt id relative to --base-ref', () => {
    const dir = tempDir();
    mkdirSync(path.join(dir, 'src'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'legacy.ts'), 'export const LEGACY_MARK = 1;\n', 'utf8');
    writeJson(path.join(dir, 'registry.json'), fixtureRegistry());
    writeJson(path.join(dir, 'debt.json'), debtDoc(['demo.forbidden.legacy']));
    git(dir, ['init']);
    git(dir, ['add', 'src/legacy.ts', 'debt.json']);
    git(dir, ['commit', '-m', 'base debt']);
    const base = git(dir, ['rev-parse', 'HEAD']);
    writeJson(path.join(dir, 'debt.json'), debtDoc(['demo.forbidden.legacy', 'demo.missing.target']));
    const result = runFixture(dir, ['--base-ref', base], { CI: 'true' });
    expect(result.status).not.toBe(0);
    expect(`${result.stderr}${result.stdout}`).toMatch(/cannot add debt id/);
  });

  it('hard-fails debt JSON with extra keys', () => {
    const dir = tempDir();
    mkdirSync(path.join(dir, 'src'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'legacy.ts'), 'export const LEGACY_MARK = 1;\n', 'utf8');
    writeJson(path.join(dir, 'registry.json'), fixtureRegistry());
    writeJson(path.join(dir, 'debt.json'), {
      ...debtDoc(['demo.forbidden.legacy', 'demo.missing.target']),
      note: 'not allowed',
    });
    const result = runFixture(dir);
    expect(result.status).not.toBe(0);
    expect(`${result.stderr}${result.stdout}`).toMatch(/keys must be exactly/);
  });

  it('hard-fails contract suite spoofs via inspect CLI', () => {
    const dir = tempDir();
    const required = [{ title: 'knowledge.contract.tools.registered-permission-deferred', minAssertions: 1 }];
    writeJson(path.join(dir, 'cases.json'), required);
    const suite = path.join(dir, 'suite.ts');
    writeFileSync(suite, "it('knowledge.contract.tools.registered-permission-deferred EXTRA', () => { expect.hasAssertions(); expect(1).toBe(1); });\n", 'utf8');
    const substring = spawnNode(ratchetCli, ['--inspect-contract-suite', '--suite-file', suite, '--required-cases-file', path.join(dir, 'cases.json')]);
    expect(substring.status).not.toBe(0);
    expect(`${substring.stderr}${substring.stdout}`).toMatch(/missing exact test title/);

    writeFileSync(suite, "it('knowledge.contract.tools.registered-permission-deferred', () => { expect.assertions(0); });\n", 'utf8');
    const zero = spawnNode(ratchetCli, ['--inspect-contract-suite', '--suite-file', suite, '--required-cases-file', path.join(dir, 'cases.json')]);
    expect(zero.status).not.toBe(0);
    expect(`${zero.stderr}${zero.stdout}`).toMatch(/assertions\(0\)/);

    writeFileSync(suite, "it('knowledge.contract.tools.registered-permission-deferred', () => { expect(1).toBe(1); });\n", 'utf8');
    const none = spawnNode(ratchetCli, ['--inspect-contract-suite', '--suite-file', suite, '--required-cases-file', path.join(dir, 'cases.json')]);
    expect(none.status).not.toBe(0);
    expect(`${none.stderr}${none.stdout}`).toMatch(/hasAssertions|assertions\(n>0\)/);

    writeFileSync(suite, "it.todo('knowledge.contract.tools.registered-permission-deferred');\n", 'utf8');
    const todo = spawnNode(ratchetCli, ['--inspect-contract-suite', '--suite-file', suite, '--required-cases-file', path.join(dir, 'cases.json')]);
    expect(todo.status).not.toBe(0);
    expect(`${todo.stderr}${todo.stdout}`).toMatch(/skip|todo|only/);

    writeFileSync(suite, "it('other.case', () => { expect.hasAssertions(); expect(1).toBe(1); });\n", 'utf8');
    const missing = spawnNode(ratchetCli, ['--inspect-contract-suite', '--suite-file', suite, '--required-cases-file', path.join(dir, 'cases.json')]);
    expect(missing.status).not.toBe(0);
    expect(`${missing.stderr}${missing.stdout}`).toMatch(/missing exact test title/);

    writeFileSync(suite, "// it('knowledge.contract.tools.registered-permission-deferred', () => { expect.hasAssertions(); expect(1).toBe(1); });\nit('knowledge.contract.tools.registered-permission-deferred', () => {});\n", 'utf8');
    const commentSpoof = spawnNode(ratchetCli, ['--inspect-contract-suite', '--suite-file', suite, '--required-cases-file', path.join(dir, 'cases.json')]);
    expect(commentSpoof.status).not.toBe(0);
    expect(`${commentSpoof.stderr}${commentSpoof.stdout}`).toMatch(/hasAssertions|assertions\(n>0\)/);

    writeFileSync(suite, "it('knowledge.contract.tools.registered-permission-deferred', () => { expect.hasAssertions(); expect(1).toBe(1); });\nit('knowledge.contract.tools.registered-permission-deferred', () => { expect.hasAssertions(); expect(2).toBe(2); });\n", 'utf8');
    const duplicate = spawnNode(ratchetCli, ['--inspect-contract-suite', '--suite-file', suite, '--required-cases-file', path.join(dir, 'cases.json')]);
    expect(duplicate.status).not.toBe(0);
    expect(`${duplicate.stderr}${duplicate.stdout}`).toMatch(/duplicate/i);

    writeFileSync(suite, "it('knowledge.contract.tools.registered-permission-deferred', () => { if (false) expect.hasAssertions(); });\n", 'utf8');
    const ifFalse = spawnNode(ratchetCli, ['--inspect-contract-suite', '--suite-file', suite, '--required-cases-file', path.join(dir, 'cases.json')]);
    expect(ifFalse.status).not.toBe(0);
    expect(`${ifFalse.stderr}${ifFalse.stdout}`).toMatch(/first direct statement|nested|control-flow/);

    writeFileSync(suite, "it('knowledge.contract.tools.registered-permission-deferred', () => { return; expect.hasAssertions(); });\n", 'utf8');
    const afterReturn = spawnNode(ratchetCli, ['--inspect-contract-suite', '--suite-file', suite, '--required-cases-file', path.join(dir, 'cases.json')]);
    expect(afterReturn.status).not.toBe(0);
    expect(`${afterReturn.stderr}${afterReturn.stdout}`).toMatch(/first direct statement|nested|control-flow/);
  });

  it('fails runtime vitest when a real callback only calls hasAssertions', () => {
    const dir = tempDir();
    const suite = path.join(dir, 'empty-guard.test.ts');
    writeJson(path.join(dir, 'cases.json'), [{ title: 'demo.case', minAssertions: 1 }]);
    writeFileSync(suite, "import { expect, it } from 'vitest';\nit('demo.case', () => { expect.hasAssertions(); });\n", 'utf8');
    const inspect = spawnNode(ratchetCli, ['--inspect-contract-suite', '--suite-file', suite, '--required-cases-file', path.join(dir, 'cases.json')]);
    expect(inspect.status).toBe(0);
    const runtime = spawnNode(ratchetCli, ['--run-contract-suite', '--suite-file', suite, '--required-cases-file', path.join(dir, 'cases.json')]);
    expect(runtime.status).not.toBe(0);
    expect(`${runtime.stderr}${runtime.stdout}`).toMatch(/vitest hard fail|expected/i);
  });

  it('hard-fails substring vitest JSON titles', () => {
    const dir = tempDir();
    writeJson(path.join(dir, 'cases.json'), [{ title: 'knowledge.contract.tools.registered-permission-deferred', minAssertions: 1 }]);
    writeJson(path.join(dir, 'report.json'), {
      numTotalTests: 1,
      numFailedTests: 0,
      numPendingTests: 0,
      numTodoTests: 0,
      testResults: [{
        assertionResults: [{
          title: 'knowledge.contract.tools.registered-permission-deferred EXTRA',
          fullName: 'suite knowledge.contract.tools.registered-permission-deferred EXTRA',
          status: 'passed',
          numPassingAsserts: 3,
        }],
      }],
    });
    const result = spawnNode(ratchetCli, [
      '--summarize-vitest-json',
      '--report-file',
      path.join(dir, 'report.json'),
      '--required-cases-file',
      path.join(dir, 'cases.json'),
    ]);
    expect(result.status).not.toBe(0);
    expect(`${result.stderr}${result.stdout}`).toMatch(/missing exact case/);
  });

  it('clears profile ceiling only with canonical knowledge or the full five tools', () => {
    const dir = tempDir();
    const file = path.join(dir, 'resources', 'agent-runtime', 'agents', 'general.agent.md');
    mkdirSync(path.dirname(file), { recursive: true });
    writeJson(path.join(dir, 'registry.json'), [{
      id: 'knowledge.missing.profile.ceiling.general',
      kind: 'missing',
      file: 'resources/agent-runtime/agents/general.agent.md',
      pattern: 'knowledge',
      probe: 'profile-knowledge-ceiling',
      note: 'ceiling',
    }]);
    writeFileSync(file, '---\nid: general\ntools: [knowledge_browse]\n---\n', 'utf8');
    const single = spawnNode(ratchetCli, ['--evaluate-only', '--repo-root', dir, '--registry-file', path.join(dir, 'registry.json')]);
    expect(single.stdout).toMatch(/knowledge\.missing\.profile\.ceiling\.general/);
    writeFileSync(file, '---\nid: general\ntools: [knowledge]\n---\n', 'utf8');
    const token = spawnNode(ratchetCli, ['--evaluate-only', '--repo-root', dir, '--registry-file', path.join(dir, 'registry.json')]);
    expect(JSON.parse(token.stdout).ids).toEqual([]);
  });

  it('hard-forbids renamed TaskStore, settings RDX MCP, and rd.* AgentTool but not plain objects', () => {
    const dir = tempDir();
    mkdirSync(path.join(dir, 'src', 'main', 'alt'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'main', 'alt', 'HiddenStore.ts'), 'import type { TaskStore } from "../agent-runtime/tasks/TaskStore";\nexport class HiddenStore implements TaskStore {}\n', 'utf8');
    const renamed = spawnNode(ratchetCli, ['--hard-forbid-only', '--repo-root', dir]);
    expect(renamed.status).not.toBe(0);
    expect(`${renamed.stderr}${renamed.stdout}`).toMatch(/hard\.task-store\.extra/);

    const mcpDir = tempDir();
    mkdirSync(path.join(mcpDir, 'src', 'renderer', 'features', 'settings'), { recursive: true });
    writeFileSync(path.join(mcpDir, 'src', 'renderer', 'features', 'settings', 'HiddenRdxMcp.ts'), "export const mcpServers = [{ name: 'rdx', command: 'rdx-mcp' }];\n", 'utf8');
    const settingsMcp = spawnNode(ratchetCli, ['--hard-forbid-only', '--repo-root', mcpDir]);
    expect(settingsMcp.status).not.toBe(0);
    expect(`${settingsMcp.stderr}${settingsMcp.stdout}`).toMatch(/hard\.rdx-mcp-or-rd-tools/);

    const plainDir = tempDir();
    mkdirSync(path.join(plainDir, 'src', 'main'), { recursive: true });
    writeFileSync(path.join(plainDir, 'src', 'main', 'plain.ts'), "export const example = { name: 'rd.foo' };\n", 'utf8');
    const plain = spawnNode(ratchetCli, ['--hard-forbid-only', '--repo-root', plainDir]);
    expect(plain.status).toBe(0);

    const toolDir = tempDir();
    mkdirSync(path.join(toolDir, 'src', 'shared', 'constants'), { recursive: true });
    writeFileSync(path.join(toolDir, 'src', 'shared', 'constants', 'agentToolTokens.ts'), "export const BUILTIN_AGENT_TOOL_IDS = ['rd.foo'];\n", 'utf8');
    const builtin = spawnNode(ratchetCli, ['--hard-forbid-only', '--repo-root', toolDir]);
    expect(builtin.status).not.toBe(0);
    expect(`${builtin.stderr}${builtin.stdout}`).toMatch(/hard\.rdx-mcp-or-rd-tools/);
  });

  it('still hard-fails autonomous writes inside KnowledgeWriteService.ts', () => {
    const dir = tempDir();
    mkdirSync(path.join(dir, 'src', 'main', 'knowledge'), { recursive: true });
    writeFileSync(
      path.join(dir, 'src', 'main', 'knowledge', 'KnowledgeWriteService.ts'),
      "export class KnowledgeWriteService {\n  onSessionEnd() { this.write({ title: 'auto' }); }\n  write(input: unknown) { return input; }\n}\n",
      'utf8',
    );
    const lifecycle = spawnNode(ratchetCli, ['--hard-forbid-only', '--repo-root', dir]);
    expect(lifecycle.status).not.toBe(0);
    expect(`${lifecycle.stderr}${lifecycle.stdout}`).toMatch(/hard\.knowledge\.session-end-write/);

    writeFileSync(
      path.join(dir, 'src', 'main', 'knowledge', 'KnowledgeWriteService.ts'),
      "export class KnowledgeWriteService {}\nexport const tools = [{ id: 'knowledge_write', inputSchema: {}, execute() {} }];\n",
      'utf8',
    );
    const tool = spawnNode(ratchetCli, ['--hard-forbid-only', '--repo-root', dir]);
    expect(tool.status).not.toBe(0);
    expect(`${tool.stderr}${tool.stdout}`).toMatch(/hard\.knowledge\.autonomy-tool/);
  });

  it('spawns both product checks at exit 0', () => {
    const localEnv = { CI: '', RDC_SYSTEM_DEBT_BASE_REF: '' };
    const knowledge = spawnNode(knowledgeCli, [], { env: localEnv });
    const investigation = spawnNode(investigationCli, [], { env: localEnv });
    expect(knowledge.status).toBe(0);
    expect(investigation.status).toBe(0);
    expect(knowledge.stdout).toMatch(/historical monotonic skipped/);
    expect(investigation.stdout).toMatch(/historical monotonic skipped/);
  }, 60_000);
});
