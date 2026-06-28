import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('./register-ts-source.cjs');

const { AGENT_WORKBENCH_TOOL_CATALOG } = require('../src/shared/constants/agentWorkbenchCatalog.ts');
const { createToolRowForPresentation } = require('../src/renderer/features/debugger/AgentChat/workProcessPresentation.ts');

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
    resultPreview: JSON.stringify({ status: 200, title: 'Example' }),
  },
  web_search: {
    argsPreview: JSON.stringify({ query: 'renderdoc' }),
    resultPreview: JSON.stringify({ results: [{ title: 'RenderDoc' }] }),
  },
  bash: {
    argsPreview: JSON.stringify({ command: 'npm run typecheck' }),
    resultPreview: JSON.stringify({ exitCode: 0, stdout: 'OK' }),
  },
  write_file: {
    argsPreview: JSON.stringify({ path: 'notes.md', content: 'hello' }),
    resultPreview: JSON.stringify({ ok: true }),
  },
  edit_file: {
    argsPreview: JSON.stringify({ path: 'src/foo.ts', patch: '...' }),
    resultPreview: JSON.stringify({ ok: true }),
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
  agent_handoff: {
    argsPreview: JSON.stringify({ agent: 'edit', prompt: 'Implement fix' }),
    resultPreview: JSON.stringify({ ok: true }),
  },
  memory_read: {
    argsPreview: JSON.stringify({ name: 'project-notes' }),
    resultPreview: JSON.stringify({ name: 'project-notes', content: '...' }),
  },
  memory_write: {
    argsPreview: JSON.stringify({ name: 'project-notes', description: 'd', type: 'user', content: 'c' }),
    resultPreview: JSON.stringify({ name: 'project-notes' }),
  },
  memory_delete: {
    argsPreview: JSON.stringify({ name: 'project-notes' }),
    resultPreview: JSON.stringify({ ok: true }),
  },
  plan_artifact: {
    argsPreview: JSON.stringify({ title: 'Plan', content: '# Plan' }),
    resultPreview: JSON.stringify({ ok: true }),
  },
  skills: {
    argsPreview: JSON.stringify({ query: 'lint' }),
    resultPreview: JSON.stringify({ skills: ['eslint'] }),
  },
  mcp: {
    argsPreview: JSON.stringify({ query: 'fs' }),
    resultPreview: JSON.stringify({ servers: ['filesystem'] }),
  },
  rdx_context: {
    argsPreview: '{}',
    resultPreview: JSON.stringify({ capturePath: 'demo.rdc' }),
  },
};

const PRIMITIVE_FIXTURES = {
  git_status: {
    argsPreview: '{}',
    resultPreview: JSON.stringify({ status: 'M README.md' }),
  },
  git_diff: {
    argsPreview: JSON.stringify({ path: 'README.md' }),
    resultPreview: JSON.stringify({ output: '+ added line' }),
  },
  search_codebase: {
    argsPreview: JSON.stringify({ query: 'ConversationService' }),
    resultPreview: JSON.stringify({ matches: ['src/main/conversation/ConversationService.ts'] }),
  },
  notebook_edit: {
    argsPreview: JSON.stringify({ path: 'notes.ipynb' }),
    resultPreview: JSON.stringify({ ok: true }),
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
};

const ALL_TOOLS = [
  ...AGENT_WORKBENCH_TOOL_CATALOG.map((tool) => tool.id),
  ...Object.keys(PRIMITIVE_FIXTURES),
].filter((id) => id !== 'ask_user');

for (const toolName of ALL_TOOLS) {
  const fixture = FIXTURES[toolName] ?? PRIMITIVE_FIXTURES[toolName];
  assert(fixture, `missing fixture for ${toolName}`);

  const row = createToolRowForPresentation({
    id: `tool-${toolName}`,
    toolName,
    status: 'complete',
    argsPreview: fixture.argsPreview,
    resultPreview: fixture.resultPreview,
    startedAt: now,
    completedAt: now + 50,
  }, true);

  assert(row.type === 'tool', `${toolName} should render as tool row`);
  assert(row.verb !== '已调用', `${toolName} should have a dedicated verb, got "${row.verb}"`);
  assert(row.target.length > 0 || row.previewLines.length > 0, `${toolName} should expose target or preview`);
}

console.log(`[work-process-tool-coverage] OK (${ALL_TOOLS.length} tools)`);
