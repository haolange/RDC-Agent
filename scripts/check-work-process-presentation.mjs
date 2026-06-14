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
      ...row.previewLines,
    ].join(' ');
  }
  if (row.type === 'userInput') {
    return [row.verb, row.question].join(' ');
  }
  if (row.type === 'approval') {
    return [row.verb, row.message, ...row.metaLines].join(' ');
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
  'Done',
  'Raw result',
  'Args',
  '"path": "package.json"',
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
assert(globRow.verb === 'List', 'glob row should use compact transcript verb');
assert(globRow.previewLines.some((line) => line.includes('src/main/index.ts')), 'glob result preview was not unwrapped');
assert(!globRow.previewLines.join('\n').includes('"ok"'), 'raw JSON leaked into tool result preview');
assert(globRow.rawLines.join('\n').includes('"ok": true'), 'raw JSON was not preserved in raw details');
assert(readRow.previewLines.length <= 6, 'read_file preview should stay compact');

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

const askUserPresentation = buildWorkProcessPresentation({
  status: 'running',
  updatedAt: now + 6000,
  blocks: [
    {
      id: 'tool-ask-user',
      kind: 'tool',
      title: 'Called ask_user',
      status: 'running',
      toolCalls: [
        {
          id: 'tool-ask',
          toolName: 'ask_user',
          status: 'running',
          argsPreview: JSON.stringify({
            question: 'Which smoke path should I use?',
            choices: ['Read-only smoke', 'Edit smoke'],
          }),
          startedAt: now + 3000,
        },
      ],
      startedAt: now + 3000,
    },
  ],
});
const askUserRow = askUserPresentation.rows.find((row) => row.type === 'userInput');
assert(askUserRow?.type === 'userInput', 'ask_user should render as a user input row');
assert(askUserRow.verb === 'Asked user', 'pending ask_user should render as Asked user');
assert(askUserRow.question.includes('Which smoke path'), 'ask_user question should be visible');
const askUserVisible = [askUserRow.verb, askUserRow.question].join(' ');
for (const forbidden of ['ask_user', '"choices"', 'Read-only smoke', 'Edit smoke', 'User input requested by']) {
  assert(!askUserVisible.includes(forbidden), `ask_user visible transcript leaked debug/raw text: ${forbidden}`);
}
assert(askUserRow.detailLines.some((line) => line.includes('Choice 1: Read-only smoke')), 'ask_user choices should remain available in details');

const answeredAskUserPresentation = buildWorkProcessPresentation({
  status: 'complete',
  updatedAt: now + 7000,
  blocks: [
    {
      id: 'tool-ask-user-answered',
      kind: 'tool',
      title: 'Called ask_user',
      status: 'complete',
      toolCalls: [
        {
          id: 'tool-ask-answered',
          toolName: 'ask_user',
          status: 'complete',
          argsPreview: JSON.stringify({ question: 'Continue?' }),
          resultPreview: 'User answered.',
          startedAt: now + 4000,
          completedAt: now + 4050,
        },
      ],
      startedAt: now + 4000,
      completedAt: now + 4050,
    },
  ],
});
const answeredAskRow = answeredAskUserPresentation.rows.find((row) => row.type === 'userInput');
assert(answeredAskRow?.type === 'userInput', 'answered ask_user row missing');
assert(answeredAskRow.verb === 'Answered user', 'answered ask_user should render as Answered user');
assert(answeredAskUserPresentation.defaultExpanded === true, 'answered ask_user trace should remain expanded');

const toolApprovalPresentation = buildWorkProcessPresentation({
  status: 'running',
  updatedAt: now + 7500,
  blocks: [
    {
      id: 'runtime-approval-tool-1',
      kind: 'approval',
      title: 'Approve bash',
      status: 'running',
      summary: 'Shell command references paths outside the workspace: type C:\\Users\\Vip\\Desktop\\Plan.md',
      detail: JSON.stringify({
        approvalId: 'tool-approval-tool-1',
        toolCallId: 'tool-1',
        toolName: 'bash',
        risk: 'medium',
      }, null, 2),
      toolCalls: [],
      startedAt: now + 4300,
    },
  ],
});
const toolApprovalRow = toolApprovalPresentation.rows.find((row) => row.type === 'approval');
assert(toolApprovalRow?.type === 'approval', 'pending tool approval should render as an approval transcript row');
assert(toolApprovalRow.verb === 'Requested approval', 'pending tool approval should render as Requested approval');
assert(toolApprovalRow.message.includes('outside the workspace'), 'tool approval reason should be visible');
assert(toolApprovalRow.metaLines.some((line) => line.includes('Tool: bash')), 'tool approval should expose compact tool context');
assert(![toolApprovalRow.verb, toolApprovalRow.message].join(' ').includes('"toolCallId"'), 'tool approval visible text must not leak raw JSON');

const autoReviewPresentation = buildWorkProcessPresentation({
  status: 'complete',
  updatedAt: now + 7600,
  blocks: [
    {
      id: 'runtime-approval-auto-review-tool-1',
      kind: 'approval',
      title: 'Auto-review bash',
      status: 'error',
      summary: 'Auto-review denied',
      detail: JSON.stringify('Auto-review denied this action. Use a safer workspace-scoped path or switch permissions.'),
      toolCalls: [],
      startedAt: now + 4400,
      completedAt: now + 4410,
    },
  ],
});
const autoReviewRow = autoReviewPresentation.rows.find((row) => row.type === 'approval');
assert(autoReviewRow?.type === 'approval', 'auto-review decision should render as an approval transcript row');
assert(autoReviewRow.verb === 'Auto-review denied', 'auto-review denial should render with reviewer semantics');
assert(autoReviewRow.message.includes('Auto-review denied'), 'auto-review decision text should be visible');

const planArtifactPresentation = buildWorkProcessPresentation({
  status: 'complete',
  updatedAt: now + 8000,
  blocks: [
    {
      id: 'tool-plan-artifact',
      kind: 'tool',
      title: 'Called plan_artifact',
      status: 'complete',
      toolCalls: [
        {
          id: 'tool-plan-artifact-call',
          toolName: 'plan_artifact',
          status: 'complete',
          argsPreview: JSON.stringify({
            title: 'Read-only smoke check',
            content: '# Smoke Path: Read-only Check\n\nLong plan body that should stay in Details.',
          }),
          resultPreview: JSON.stringify({
            ok: true,
            data: {
              content: [{ type: 'text', text: 'Plan artifact saved: D:\\Projects\\agentTest\\rdc\\sessions\\sess\\artifacts\\plan.md' }],
            },
          }),
          startedAt: now + 5000,
          completedAt: now + 5005,
        },
      ],
      startedAt: now + 5000,
      completedAt: now + 5005,
    },
  ],
});
const planArtifactRow = planArtifactPresentation.rows.find((row) => row.type === 'tool');
assert(planArtifactRow?.type === 'tool', 'plan_artifact row missing');
assert(planArtifactRow.verb === 'Write', 'plan_artifact should render as a write transcript action');
assert(planArtifactRow.target === 'Read-only smoke check', 'plan_artifact should use title as visible target');
assert(!planArtifactRow.target.includes('Long plan body'), 'plan_artifact must not leak content args as target');

const truncatedPayloadPresentation = buildWorkProcessPresentation({
  status: 'complete',
  updatedAt: now + 9000,
  blocks: [
    {
      id: 'tool-plan-artifact-truncated',
      kind: 'tool',
      title: 'Called plan_artifact',
      status: 'complete',
      toolCalls: [
        {
          id: 'tool-plan-artifact-truncated-call',
          toolName: 'plan_artifact',
          status: 'complete',
          argsPreview: '{"content":"# Smoke Path: Read-only Check\\n\\n## Goal\\nThis payload was truncated before valid JSON',
          resultPreview: 'Plan artifact saved: D:\\Projects\\agentTest\\rdc\\sessions\\sess\\artifacts\\plan.md',
          startedAt: now + 6000,
          completedAt: now + 6005,
        },
      ],
      startedAt: now + 6000,
      completedAt: now + 6005,
    },
  ],
});
const truncatedPayloadRow = truncatedPayloadPresentation.rows.find((row) => row.type === 'tool');
assert(truncatedPayloadRow?.type === 'tool', 'truncated plan_artifact row missing');
assert(truncatedPayloadRow.target === '', 'invalid raw content JSON must not render as a visible target');

const fs = require('node:fs');
const componentSource = fs.readFileSync('src/renderer/features/debugger/AgentChat/WorkProcess.tsx', 'utf8');
const cssSource = fs.readFileSync('src/renderer/features/debugger/AgentChat/AgentChat.css', 'utf8');
const messageBubbleSource = fs.readFileSync('src/renderer/features/debugger/AgentChat/MessageBubble.tsx', 'utf8');
const userInputPanelSource = fs.readFileSync('src/renderer/features/debugger/composer/UserInputRequestPanel.tsx', 'utf8');
const userInputSubmitHookSource = fs.readFileSync('src/renderer/features/debugger/composer/useUserInputRequestSubmit.ts', 'utf8');
const toolApprovalPanelSource = fs.readFileSync('src/renderer/features/debugger/composer/ToolApprovalRequestPanel.tsx', 'utf8');
const toolApprovalSubmitHookSource = fs.readFileSync('src/renderer/features/debugger/composer/useToolApprovalSubmit.ts', 'utf8');
const orchestratorSource = fs.readFileSync('src/main/workflow/debugger/AgentOrchestrator.ts', 'utf8');

assert(!componentSource.includes('className={`work-process-tool status-${row.status}`} open='), 'tool row should not hide transcript preview behind a parent details');
assert(componentSource.includes('<div className={`work-process-tool status-${row.status}`}>'), 'tool row should render as a fixed transcript block');
assert(componentSource.includes('<summary>Details</summary>'), 'tool args/raw should be grouped under a single Details disclosure');
assert(componentSource.includes('work-process-user-input'), 'ask_user should have a dedicated user input transcript row');
assert(componentSource.includes('work-process-approval'), 'tool approval should have a dedicated transcript row');
assert(cssSource.includes('.work-process-row-detail:not([open]) > :not(summary)'), 'closed Work Process details must not render debug pre content');
assert(!cssSource.includes('WorkProcess v2 - linear agent trace'), 'legacy Work Process CSS block should be removed');
assert(!cssSource.includes('work-process-tool-raw'), 'legacy raw-result CSS class should be removed');
assert(messageBubbleSource.includes('Next actions'), 'handoff actions should render with a low-noise Next actions label');
assert(!messageBubbleSource.includes('<small>{resolveAgentDisplay'), 'handoff button should not render target agent as visible small text');
assert(!userInputPanelSource.includes('window.electronAPI'), 'composer user input panel must not call Electron APIs directly');
assert(userInputSubmitHookSource.includes('answerUserInput'), 'composer user input hook must submit through conversation.answerUserInput');
assert(!toolApprovalPanelSource.includes('window.electronAPI'), 'composer tool approval panel must not call Electron APIs directly');
assert(toolApprovalSubmitHookSource.includes('answerToolApproval'), 'composer tool approval hook must submit through conversation.answerToolApproval');
assert(!orchestratorSource.includes('User input requested by'), 'ask_user tool must not return fake user-request text immediately');

console.log('[work-process] OK');
