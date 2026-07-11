import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('./register-ts-source.cjs');

const { AGENT_WORKBENCH_TOOL_CATALOG } = require('../src/shared/constants/agentWorkbenchCatalog.ts');
const { BUILTIN_AGENT_TOOL_IDS } = require('../src/shared/constants/agentToolTokens.ts');
const {
  WORK_PROCESS_TOOL_DISPLAY_CATALOG,
  createToolRowForPresentation,
  getToolFamily,
} = require('../src/renderer/features/debugger/AgentChat/workProcessPresentation.ts');
const { buildToolAggregateSummary } = require('../src/renderer/features/debugger/AgentChat/workProcessToolAggregate.ts');

const fail = (message) => {
  console.error(`[work-process-tool-coverage] ${message}`);
  process.exit(1);
};

const assert = (condition, message) => {
  if (!condition) fail(message);
};

const now = 1_700_000_000_000;

const toolEnvelope = (text, details = {}, extra = {}) => JSON.stringify({
  ok: true,
  data: {
    content: text ? [{ type: 'text', text }] : [],
    details,
  },
  duration_ms: 16,
  ...extra,
});

const FIXTURES = {
  read_file: {
    argsPreview: JSON.stringify({ path: 'src/main/index.ts' }),
    resultPreview: toolEnvelope('     1→export {}\n     2→', { path: 'src/main/index.ts', totalLines: 12, offset: 1, limit: 2000, truncated: false }),
  },
  glob: {
    argsPreview: JSON.stringify({ pattern: '**/package.json' }),
    resultPreview: toolEnvelope('package.json\ntools/package.json', { pattern: '**/package.json', cwd: '.', matched: 2, truncated: false }),
  },
  grep: {
    argsPreview: JSON.stringify({ pattern: 'export', path: 'src' }),
    resultPreview: toolEnvelope('src/index.ts:1: export const x = 1', { pattern: 'export', root: 'src', matchedFiles: 1, matchedLines: 1, truncated: false }),
  },
  web_fetch: {
    argsPreview: JSON.stringify({ url: 'https://example.com' }),
    resultPreview: toolEnvelope('Status: 200 OK', { kind: 'fetch', url: 'https://example.com/', status: 200, statusText: 'OK', bytes: 1256, truncated: false }),
  },
  web_search: {
    argsPreview: JSON.stringify({ query: 'renderdoc' }),
    resultPreview: toolEnvelope('Search query: renderdoc', {
      kind: 'search',
      provider: 'DuckDuckGo HTML',
      resultCount: 1,
      results: [{ title: 'RenderDoc', url: 'https://renderdoc.org/', snippet: 'Graphics debugger.' }],
    }),
  },
  bash: {
    argsPreview: JSON.stringify({ command: 'npm run typecheck' }),
    resultPreview: toolEnvelope('OK', { command: 'npm run typecheck', exitCode: 0, durationMs: 120, truncated: false, cwd: '.' }),
  },
  write_file: {
    argsPreview: JSON.stringify({ path: 'notes.md', content: 'hello' }),
    resultPreview: toolEnvelope('Created notes.md (5 bytes)', { path: 'notes.md', bytesWritten: 5, created: true }),
  },
  edit_file: {
    argsPreview: JSON.stringify({ path: 'src/foo.ts', old_text: 'a', new_text: 'b' }),
    resultPreview: toolEnvelope('Updated src/foo.ts', { path: 'src/foo.ts', oldLength: 1, newLength: 1, occurrence: 1, delta: 0 }),
  },
  delete_file: {
    argsPreview: JSON.stringify({ path: 'tmp.txt' }),
    resultPreview: toolEnvelope('Deleted tmp.txt', { path: 'tmp.txt' }),
  },
  move_file: {
    argsPreview: JSON.stringify({ source: 'a.txt', destination: 'b.txt' }),
    resultPreview: toolEnvelope('Moved a.txt → b.txt', { source: 'a.txt', destination: 'b.txt' }),
  },
  copy_file: {
    argsPreview: JSON.stringify({ source: 'a.txt', destination: 'b.txt' }),
    resultPreview: toolEnvelope('Copied a.txt → b.txt', { source: 'a.txt', destination: 'b.txt' }),
  },
  notebook_edit: {
    argsPreview: JSON.stringify({ notebook_path: 'notes.ipynb', cell_index: 0, new_source: 'print(1)' }),
    resultPreview: toolEnvelope('Updated notes.ipynb cell 0', { notebook_path: 'notes.ipynb', cell_index: 0 }),
  },
  git_status: {
    argsPreview: JSON.stringify({ cwd: '.' }),
    resultPreview: toolEnvelope('M README.md', { summary: 'M README.md', status: 'dirty' }),
  },
  git_diff: {
    argsPreview: JSON.stringify({ path: 'README.md' }),
    resultPreview: toolEnvelope('+ added line', { path: 'README.md' }),
  },
  git_log: {
    argsPreview: JSON.stringify({ limit: 5 }),
    resultPreview: toolEnvelope('abc123 message', { limit: 5 }),
  },
  git_add: {
    argsPreview: JSON.stringify({ path: 'README.md' }),
    resultPreview: toolEnvelope('Staged README.md', { path: 'README.md' }),
  },
  git_unstage: {
    argsPreview: JSON.stringify({ path: 'README.md' }),
    resultPreview: toolEnvelope('Unstaged README.md', { path: 'README.md' }),
  },
  git_commit: {
    argsPreview: JSON.stringify({ message: 'Update work process' }),
    resultPreview: toolEnvelope('[main abc123] Update work process', { message: 'Update work process' }),
  },
  task_list: {
    argsPreview: '{}',
    resultPreview: toolEnvelope('- Ship feature', { total: 1, tasks: [{ subject: 'Ship feature' }] }),
  },
  task_create: {
    argsPreview: JSON.stringify({ subject: 'New task' }),
    resultPreview: toolEnvelope('Created task-1: New task', { taskId: 'task-1', subject: 'New task' }),
  },
  task_update: {
    argsPreview: JSON.stringify({ taskId: 'task-1', status: 'done' }),
    resultPreview: toolEnvelope('Updated task-1', { taskId: 'task-1' }),
  },
  task_get: {
    argsPreview: JSON.stringify({ taskId: 'task-1' }),
    resultPreview: toolEnvelope('New task', { taskId: 'task-1', subject: 'New task' }),
  },
  task_stop: {
    argsPreview: JSON.stringify({ taskId: 'task-1' }),
    resultPreview: toolEnvelope('Stopped task-1', { taskId: 'task-1', status: 'stopped' }),
  },
  agent_handoff: {
    argsPreview: JSON.stringify({ agent: 'edit', prompt: 'Implement fix' }),
    resultPreview: toolEnvelope('Handoff ready', { agent: 'edit' }),
  },
  subagent: {
    argsPreview: JSON.stringify({ profile: 'reviewer', prompt: 'Review this' }),
    resultPreview: toolEnvelope('Reviewed', { summary: 'Reviewed' }),
  },
  memory_search: {
    argsPreview: JSON.stringify({ scope: 'project', query: 'project-notes' }),
    resultPreview: toolEnvelope('project-notes', { count: 1 }),
  },
  memory_read: {
    argsPreview: JSON.stringify({ scope: 'project', name: 'project-notes' }),
    resultPreview: toolEnvelope('note body', { name: 'project-notes' }),
  },
  memory_write: {
    argsPreview: JSON.stringify({ scope: 'project', name: 'project-notes', description: 'd', type: 'project', content: 'c', approved: true }),
    resultPreview: toolEnvelope('Wrote project-notes', { name: 'project-notes' }),
  },
  memory_delete: {
    argsPreview: JSON.stringify({ scope: 'project', name: 'project-notes', confirmed: true }),
    resultPreview: toolEnvelope('Deleted project-notes', { name: 'project-notes' }),
  },
  plan_artifact: {
    argsPreview: JSON.stringify({ title: 'Plan', content: '# Plan' }),
    resultPreview: toolEnvelope('Plan artifact ready', { title: 'Plan' }),
  },
  tool_search: {
    argsPreview: JSON.stringify({ query: 'node_repl' }),
    resultPreview: toolEnvelope('node_repl.js', { total: 1, matches: [{ name: 'node_repl.js' }] }),
  },
  skills: {
    argsPreview: JSON.stringify({ query: 'lint' }),
    resultPreview: toolEnvelope('eslint', { total: 1, skills: ['eslint'] }),
  },
  skill_read: {
    argsPreview: JSON.stringify({ skill_id: 'baoyu-design' }),
    resultPreview: toolEnvelope('# Design\n\nFull body stays in raw.', {
      skillId: 'baoyu-design',
      description: 'Create polished design artifacts.',
      sourcePath: '/skills/baoyu-design/SKILL.md',
    }),
  },
  mcp: {
    argsPreview: JSON.stringify({ query: 'fs' }),
    resultPreview: toolEnvelope('filesystem', { servers: ['filesystem'] }),
  },
  rdx_context: {
    argsPreview: '{}',
    resultPreview: toolEnvelope('capture: demo.rdc', { capturePath: 'demo.rdc' }),
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
    resultPreview: toolEnvelope('Yes', {
      answers: [{ questionId: 'continue', answer: 'Yes', selectedOptionId: 'yes' }],
    }),
  },
  mcp__filesystem__read_file: {
    argsPreview: JSON.stringify({ path: 'README.md' }),
    resultPreview: toolEnvelope('hello', { path: 'README.md' }),
  },
};

const workbenchToolIds = AGENT_WORKBENCH_TOOL_CATALOG.map((tool) => tool.id);
const builtinIds = [...BUILTIN_AGENT_TOOL_IDS];
const missingFromCatalog = builtinIds.filter((id) => !workbenchToolIds.includes(id));
const extraInCatalog = workbenchToolIds.filter((id) => !builtinIds.includes(id));
assert(missingFromCatalog.length === 0, `AGENT_WORKBENCH_TOOL_CATALOG missing builtin ids: ${missingFromCatalog.join(', ')}`);
assert(extraInCatalog.length === 0, `AGENT_WORKBENCH_TOOL_CATALOG has unknown ids: ${extraInCatalog.join(', ')}`);
assert(new Set(workbenchToolIds).size === workbenchToolIds.length, 'AGENT_WORKBENCH_TOOL_CATALOG has duplicate ids');

const aggregateTools = ['read_file', 'read_file', 'glob'].map((toolName, index) => createToolRowForPresentation({
  id: `tool-aggregate-${index}`,
  toolName,
  status: 'complete',
  argsPreview: FIXTURES[toolName].argsPreview,
  resultPreview: FIXTURES[toolName].resultPreview,
  startedAt: now + index,
  completedAt: now + index + 10,
}, true));
assert(typeof buildToolAggregateSummary === 'function', 'buildToolAggregateSummary should be exported');
assert(buildToolAggregateSummary(aggregateTools).includes('读取了'), 'tool aggregate summary should classify read_file actions');

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
  assert(
    ['file', 'search', 'shell', 'git', 'web', 'generic'].includes(row.family),
    `${toolName} should expose a unified card family, got "${row.family}"`,
  );
  assert(row.family === getToolFamily(toolName), `${toolName} family should match getToolFamily()`);

  if (toolName.startsWith('mcp__')) {
    assert(row.target === 'filesystem/read_file', `dynamic MCP target should be server/tool, got "${row.target}"`);
    assert(row.groupKind === 'mcp', `dynamic MCP tool should be in mcp group, got "${row.groupKind}"`);
    assert(row.family === 'generic', `dynamic MCP tools should use the generic card family`);
  }

  if (toolName === 'glob') {
    assert(row.bodyText && /\d+\s+files?/.test(row.bodyText), `glob bodyText should be a file count, got "${row.bodyText}"`);
    assert(row.bodyText !== '**/package.json', 'glob collapsed body must not be only the pattern');
    assert(row.bodyLines?.includes('package.json'), 'glob should expose path samples in bodyLines');
    assert(row.previewLines.includes('package.json'), 'glob previewLines should include matched paths');
  }

  if (toolName === 'grep') {
    assert(row.bodyText && /match/i.test(row.bodyText), `grep bodyText should summarize matches, got "${row.bodyText}"`);
    assert(row.bodyText !== 'export' && row.bodyText !== 'src', 'grep collapsed body must not be only args');
    assert(row.previewLines.some((line) => line.includes('src/index.ts')), 'grep preview should include match lines');
  }

  if (toolName === 'read_file') {
    assert(row.bodyText && row.bodyText.includes('src/main/index.ts'), 'read_file body should keep the path');
    assert(row.bodyText.includes('12 lines'), `read_file body should include totalLines, got "${row.bodyText}"`);
    assert(row.previewLines.some((line) => line.includes('export')), 'read_file preview should include file content');
  }
}

console.log(`[work-process-tool-coverage] OK (${allTools.length} tools)`);
