import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('./register-ts-source.cjs');

const { buildWorkProcessPresentation } = require('../src/renderer/features/debugger/AgentChat/workProcessPresentation.ts');

const now = 1_700_000_000_000;

const trace = {
  status: 'complete',
  summary: '回复已完成',
  updatedAt: now + 4000,
  blocks: [
    {
      id: 'runtime-run',
      kind: 'reasoning',
      title: 'Agent Loop 完成',
      status: 'complete',
      summary: '模型与工具循环已完成。',
      detail: 'Model: kimi-code',
      toolCalls: [],
      startedAt: now,
      completedAt: now + 3000,
    },
    {
      id: 'reasoning-1',
      kind: 'reasoning',
      title: '思考过程',
      status: 'complete',
      summary: 'I need to inspect package.json and the src/main tree before answering.',
      detail: '',
      toolCalls: [],
      startedAt: now + 100,
      completedAt: now + 300,
    },
    {
      id: 'tools-1',
      kind: 'tool',
      title: 'Called 2 tools',
      status: 'complete',
      toolCalls: [
        {
          id: 'tool-read',
          toolName: 'read_file',
          status: 'complete',
          argsPreview: JSON.stringify({ path: 'package.json' }),
          resultPreview: String.raw`{"ok":true,"data":{"content":[{"type":"text","text":"     1->{
     2->  \"name\": \"rdc-agent\",
     3->  \"version\": \"1.0.0\",
     4->  \"description\": \"RenderDoc Debug Agent - Vertical Framework\"`,
          startedAt: now + 400,
          completedAt: now + 500,
        },
        {
          id: 'tool-glob',
          toolName: 'glob',
          status: 'complete',
          argsPreview: JSON.stringify({ pattern: 'src/main/*' }),
          resultPreview: JSON.stringify({
            ok: true,
            data: {
              content: [{ type: 'text', text: 'src/main/index.ts\nsrc/main/conversation\nsrc/main/workflow' }],
            },
            duration_ms: 35,
          }),
          startedAt: now + 600,
          completedAt: now + 700,
        },
      ],
      startedAt: now + 400,
      completedAt: now + 700,
    },
    {
      id: 'assistant-output',
      kind: 'output',
      title: '生成最终回答',
      status: 'complete',
      summary: '最终回答已生成。',
      detail: '',
      toolCalls: [],
      startedAt: now + 800,
      completedAt: now + 900,
    },
    {
      id: 'runtime-approval-after-answer',
      kind: 'approval',
      title: '请求用户决策',
      status: 'complete',
      summary: '请求用户决策',
      detail: '',
      toolCalls: [],
      startedAt: now + 1000,
      completedAt: now + 1100,
    },
  ],
};

const fail = (message) => {
  console.error(`[work-process] ${message}`);
  process.exit(1);
};

const assert = (condition, message) => {
  if (!condition) fail(message);
};

const presentation = buildWorkProcessPresentation(trace);
const visibleText = presentation.rows.map((row) => {
  if (row.type === 'tool') {
    return [
      row.verb,
      row.toolName,
      row.target,
      row.category,
      ...row.previewLines,
    ].join(' ');
  }
  if (row.type === 'diagnostic') return row.message;
  return row.text;
}).join('\n');

for (const forbidden of [
  'Agent Loop 完成',
  '模型与工具循环已完成',
  '生成最终回答',
  '最终回答已生成',
  '请求用户决策',
  'Thinking Agent Loop',
]) {
  assert(!visibleText.includes(forbidden), `visible transcript leaked noisy label: ${forbidden}`);
}

const globRow = presentation.rows.find((row) => row.type === 'tool' && row.toolName === 'glob');
const readRow = presentation.rows.find((row) => row.type === 'tool' && row.toolName === 'read_file');
assert(readRow, 'read_file tool row missing');
assert(readRow.previewLines.some((line) => line.includes('"name": "rdc-agent"')), 'json-ish read_file result was not unwrapped');
assert(readRow.previewLines.some((line) => line.includes('"version": "1.0.0"')), 'json-ish read_file result was truncated');
assert(!readRow.previewLines.join('\n').includes('"ok"'), 'json-ish raw JSON leaked into read_file preview');
assert(globRow, 'glob tool row missing');
assert(globRow.previewLines.some((line) => line.includes('src/main/index.ts')), 'glob result preview was not unwrapped');
assert(!globRow.previewLines.join('\n').includes('"ok"'), 'raw JSON leaked into tool result preview');
assert(globRow.rawLines.join('\n').includes('"ok": true'), 'raw JSON was not preserved in raw details');

assert(presentation.defaultExpanded === true, 'complete trace should default to expanded');
assert(presentation.stepCount === 3, `expected 3 visible transcript rows, got ${presentation.stepCount}`);
assert(presentation.toolCount === 2, `expected 2 tool rows, got ${presentation.toolCount}`);

const blockedPresentation = buildWorkProcessPresentation({
  status: 'complete',
  updatedAt: now + 5000,
  blocks: [
    {
      id: 'tool-blocked',
      kind: 'tool',
      title: 'Called 1 tool',
      status: 'complete',
      toolCalls: [
        {
          id: 'tool-write-blocked',
          toolName: 'write_file',
          status: 'complete',
          argsPreview: JSON.stringify({ path: '.tmp-workprocess-smoke.txt', content: 'work process smoke' }),
          resultPreview: 'Approval required for tool "write_file" before workspace mutation can run for edit. No changes were made.',
          startedAt: now + 2000,
          completedAt: now + 2010,
        },
      ],
      startedAt: now + 2000,
      completedAt: now + 2010,
    },
  ],
});
const blockedRow = blockedPresentation.rows.find((row) => row.type === 'tool');
assert(blockedRow?.type === 'tool', 'blocked write_file row missing');
assert(blockedRow.status === 'error', 'approval-blocked write_file should render as failed');
assert(blockedRow.verb === 'Blocked', 'approval-blocked write_file should not render as Wrote');

console.log('[work-process] OK');
