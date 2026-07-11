import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('./register-ts-source.cjs');

const { AGENT_WORKBENCH_TOOL_CATALOG } = require('../src/shared/constants/agentWorkbenchCatalog.ts');
const { BUILTIN_AGENT_TOOL_IDS } = require('../src/shared/constants/agentToolTokens.ts');
const {
  WORK_PROCESS_TOOL_DISPLAY_CATALOG,
  createToolRowForPresentation,
} = require('../src/renderer/features/debugger/AgentChat/workProcessPresentation.ts');

const fail = (message) => {
  console.error(`[work-process-tool-coverage] ${message}`);
  process.exit(1);
};

const assert = (condition, message) => {
  if (!condition) fail(message);
};

const now = 1_700_000_000_000;

const FIXTURES = {
  read_file: {
    argsPreview: JSON.stringify({ path: 'src/main/index.ts' }),
    resultPreview: JSON.stringify({ content: 'export {}', lineCount: 12 }),
  },
  glob: {
    argsPreview: JSON.stringify({ pattern: '**/package.json' }),
    resultPreview: JSON.stringify({ matches: ['package.json', 'tools/package.json'] }),
  },
  grep: {
    argsPreview: JSON.stringify({ pattern: 'export', path: 'src' }),
    resultPreview: JSON.stringify({ matches: ['src/index.ts:1'] }),
  },
  web_fetch: {
    argsPreview: JSON.stringify({ url: 'https://example.com' }),
    resultPreview: JSON.stringify({ ok: true, data: { content: [{ type: 'text', text: 'Status: 200 OK' }], details: { kind: 'fetch', url: 'https://example.com/', status: 200, statusText: 'OK', bytes: 1256, truncated: false } } }),
  },
  web_search: {
    argsPreview: JSON.stringify({ query: 'renderdoc' }),
    resultPreview: JSON.stringify({ ok: true, data: { content: [{ type: 'text', text: 'Search query: renderdoc' }], details: { kind: 'search', provider: 'DuckDuckGo HTML', resultCount: 1, results: [{ title: 'RenderDoc', url: 'https://renderdoc.org/', snippet: 'Graphics debugger.' }] } } }),
  },
  bash: {
    argsPreview: JSON.stringify({ command: 'npm run typecheck' }),
    resultPreview: JSON.stringify({ exitCode: 0, stdout: 'OK' }),
  },
  write_file: {
    argsPreview: JSON.stringify({ path: 'notes.md', content: 'hello' }),
    resultPreview: JSON.stringify({ ok: true, bytes: 5 }),
  },
  edit_file: {
    argsPreview: JSON.stringify({ path: 'src/foo.ts', patch: '...' }),
    resultPreview: JSON.stringify({ ok: true, additions: 3, deletions: 1 }),
  },
  delete_file: {
    argsPreview: JSON.stringify({ path: 'tmp.txt' }),
    resultPreview: JSON.stringify({ ok: true }),
  },
  move_file: {
    argsPreview: JSON.stringify({ source: 'a.txt', destination: 'b.txt' }),
    resultPreview: JSON.stringify({ ok: true }),
  },
  copy_file: {
    argsPreview: JSON.stringify({ source: 'a.txt', destination: 'b.txt' }),
    resultPreview: JSON.stringify({ ok: true }),
  },
  notebook_edit: {
    argsPreview: JSON.stringify({ path: 'notes.ipynb' }),
    resultPreview: JSON.stringify({ ok: true }),
  },
  git_status: {
    argsPreview: JSON.stringify({ cwd: '.' }),
    resultPreview: JSON.stringify({ summary: 'M README.md', status: 'dirty' }),
  },
  git_diff: {
    argsPreview: JSON.stringify({ path: 'README.md' }),
    resultPreview: JSON.stringify({ output: '+ added line' }),
  },
  git_log: {
    argsPreview: JSON.stringify({ limit: 5 }),
    resultPreview: JSON.stringify({ output: 'abc123 message' }),
  },
  git_add: {
    argsPreview: JSON.stringify({ path: 'README.md' }),
    resultPreview: JSON.stringify({ ok: true }),
  },
  git_unstage: {
    argsPreview: JSON.stringify({ path: 'README.md' }),
    resultPreview: JSON.stringify({ ok: true }),
  },
  git_commit: {
    argsPreview: JSON.stringify({ message: 'Update work process' }),
    resultPreview: JSON.stringify({ output: '[main abc123] Update work process' }),
  },
  task_list: {
    argsPreview: '{}',
    resultPreview: JSON.stringify({ tasks: [{ subject: 'Ship feature' }] }),
  },
  task_create: {
    argsPreview: JSON.stringify({ subject: 'New task' }),
    resultPreview: JSON.stringify({ taskId: 'task-1', subject: 'New task' }),
  },
  task_update: {
    argsPreview: JSON.stringify({ taskId: 'task-1', status: 'done' }),
    resultPreview: JSON.stringify({ taskId: 'task-1' }),
  },
  task_get: {
    argsPreview: JSON.stringify({ taskId: 'task-1' }),
    resultPreview: JSON.stringify({ subject: 'New task' }),
  },
  task_stop: {
    argsPreview: JSON.stringify({ taskId: 'task-1' }),
    resultPreview: JSON.stringify({ taskId: 'task-1', status: 'stopped' }),
  },
  agent_handoff: {
    argsPreview: JSON.stringify({ agent: 'edit', prompt: 'Implement fix' }),
    resultPreview: JSON.stringify({ ok: true }),
  },
  subagent: {
    argsPreview: JSON.stringify({ profile: 'reviewer', prompt: 'Review this' }),
    resultPreview: JSON.stringify({ ok: true, summary: 'Reviewed' }),
  },
  memory_search: {
    argsPreview: JSON.stringify({ scope: 'project', query: 'project-notes' }),
    resultPreview: JSON.stringify({ count: 1 }),
  },
  memory_read: {
    argsPreview: JSON.stringify({ scope: 'project', name: 'project-notes' }),
    resultPreview: JSON.stringify({ name: 'project-notes', content: '...' }),
  },
  memory_write: {
    argsPreview: JSON.stringify({ scope: 'project', name: 'project-notes', description: 'd', type: 'project', content: 'c', approved: true }),
    resultPreview: JSON.stringify({ name: 'project-notes' }),
  },
  memory_delete: {
    argsPreview: JSON.stringify({ scope: 'project', name: 'project-notes', confirmed: true }),
    resultPreview: JSON.stringify({ ok: true }),
  },
  plan_artifact: {
    argsPreview: JSON.stringify({ title: 'Plan', content: '# Plan' }),
    resultPreview: JSON.stringify({ ok: true }),
  },
  tool_search: {
    argsPreview: JSON.stringify({ query: 'node_repl' }),
    resultPreview: JSON.stringify({ tools: ['node_repl.js'] }),
  },
  skills: {
    argsPreview: JSON.stringify({ query: 'lint' }),
    resultPreview: JSON.stringify({ skills: ['eslint'] }),
  },
  skill_read: {
    argsPreview: JSON.stringify({ skill_id: 'baoyu-design' }),
    resultPreview: JSON.stringify({ ok: true }),
  },
  mcp: {
    argsPreview: JSON.stringify({ query: 'fs' }),
    resultPreview: JSON.stringify({ servers: ['filesystem'] }),
  },
  rdx_context: {
    argsPreview: '{}',
    resultPreview: JSON.stringify({ capturePath: 'demo.rdc' }),
  },
  ask_user: {
    argsPreview: JSON.stringify({
      questions: [{
        questionId: 'continue',
        prompt: 'Continue?',
        options: [
          { optionId: 'yes', label: 'Yes' },
          { optionId: 'no', label: 'No' },
        ],
      }],
    }),
    resultPreview: JSON.stringify({
      answers: [{ questionId: 'continue', answer: 'Yes', selectedOptionId: 'yes' }],
    }),
  },
  mcp__filesystem__read_file: {
    argsPreview: JSON.stringify({ path: 'README.md' }),
    resultPreview: JSON.stringify({ ok: true, content: 'hello' }),
  },
};

const workbenchToolIds = AGENT_WORKBENCH_TOOL_CATALOG.map((tool) => tool.id);
const builtinIds = [...BUILTIN_AGENT_TOOL_IDS];
const missingFromCatalog = builtinIds.filter((id) => !workbenchToolIds.includes(id));
const extraInCatalog = workbenchToolIds.filter((id) => !builtinIds.includes(id));
assert(missingFromCatalog.length === 0, `AGENT_WORKBENCH_TOOL_CATALOG missing builtin ids: ${missingFromCatalog.join(', ')}`);
assert(extraInCatalog.length === 0, `AGENT_WORKBENCH_TOOL_CATALOG has unknown ids: ${extraInCatalog.join(', ')}`);
assert(new Set(workbenchToolIds).size === workbenchToolIds.length, 'AGENT_WORKBENCH_TOOL_CATALOG has duplicate ids');

const PLAN_REQUIRED_TOOLS = [...workbenchToolIds, 'mcp__filesystem__read_file'];
const allTools = [...new Set(PLAN_REQUIRED_TOOLS)];

for (const toolName of allTools) {
  const fixture = FIXTURES[toolName];
  assert(fixture, `missing fixture for ${toolName}`);

  if (!toolName.startsWith('mcp__') && toolName !== 'ask_user') {
    assert(WORK_PROCESS_TOOL_DISPLAY_CATALOG[toolName], `${toolName} missing display catalog entry`);
  }

  const row = createToolRowForPresentation({
    id: `tool-${toolName}`,
    toolName,
    status: 'complete',
    argsPreview: fixture.argsPreview,
    resultPreview: fixture.resultPreview,
    startedAt: now,
    completedAt: now + 50,
  }, true);

  if (toolName === 'ask_user') {
    assert(row.type === 'userInput', 'ask_user should render as userInput row');
    assert(row.verb !== 'Asked user', 'ask_user should use localized semantic verb');
    assert(row.items.length > 0 && row.items[0].prompt.length > 0, 'ask_user should expose transcript question items');
    continue;
  }

  assert(row.type === 'tool', `${toolName} should render as tool row`);
  assert(row.verb !== 'Called tool' && row.verb !== '已调用工具', `${toolName} should have a dedicated verb, got "${row.verb}"`);
  assert(row.icon && row.icon !== 'tool', `${toolName} should have a semantic icon, got "${row.icon}"`);
  assert(row.groupKind && row.groupKind !== 'diagnostic', `${toolName} should have a semantic group`);
  assert(row.category.length > 0, `${toolName} should have a category`);
  assert(row.target.length > 0 || row.previewLines.length > 0, `${toolName} should expose target or preview`);

  if (toolName.startsWith('mcp__')) {
    assert(row.target === 'filesystem/read_file', `dynamic MCP target should be server/tool, got "${row.target}"`);
    assert(row.groupKind === 'mcp', `dynamic MCP tool should be in mcp group, got "${row.groupKind}"`);
  }
}

console.log(`[work-process-tool-coverage] OK (${allTools.length} tools)`);
