import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('./register-ts-source.cjs');

const { buildWorkProcessPresentation, normalizeSegmentPrimaryText } = require('../src/renderer/features/debugger/AgentChat/workProcessPresentation.ts');
const { normalizeAssistantMarkdown } = require('../src/renderer/features/debugger/AgentChat/normalizeAssistantMarkdown.ts');

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

assert(
  normalizeSegmentPrimaryText('  line one  \n\n\n\nline two  ') === 'line one\n\nline two',
  'segment primary text should collapse excessive blank lines',
);
const normalizedMarkdown = normalizeAssistantMarkdown('总结：\n\n◦ **我是谁：** Edit\n\n\n◦ **有什么用：** help');
assert(normalizedMarkdown.includes('### 总结'), 'markdown normalizer should promote section headings');
assert(!normalizedMarkdown.includes('\n\n\n'), 'markdown normalizer should glue list items without triple blank gaps');
assert(normalizedMarkdown.includes('- **我是谁：**'), 'markdown normalizer should convert pseudo bullets');

// 思维链已按 agent 轮次分组：工具步骤在 section.steps 内，需递归展开查找。
const flattenRows = (rows) => rows.flatMap((row) => (
  row.type === 'section' ? [row, ...flattenRows(row.steps)] : [row]
));
const collectVisible = (rows) => rows.flatMap((row) => {
  if (row.type === 'section') return [row.primaryText, ...collectVisible(row.steps)];
  if (row.type === 'tool') return [row.verb, row.toolName, row.target, ...row.previewLines];
  if (row.type === 'userInput') return [row.verb, row.question];
  if (row.type === 'approval') return [row.verb, row.message, ...row.metaLines];
  if (row.type === 'diagnostic') return [row.message];
  return [row.text];
});

const presentation = buildWorkProcessPresentation(trace);
const flatRows = flattenRows(presentation.rows);
const visibleText = collectVisible(presentation.rows).join('\n');

for (const forbidden of [
  'Agent Loop 完成',
  '模型与工具循环已完成',
  '生成最终回答',
  '最终回答已生成',
  '请求用户决策',
  'Thinking Agent Loop',
  'Done',
  '"path": "package.json"',
]) {
  assert(!visibleText.includes(forbidden), `visible transcript leaked noisy label: ${forbidden}`);
}

const toolSection = presentation.rows.find((row) => row.type === 'section');
assert(toolSection?.type === 'section', 'tool calls should be grouped into a work-process section');
assert(toolSection.steps.length === 2, `tool section should contain its tool steps, got ${toolSection.steps.length}`);
assert(toolSection.stepCount === 2, 'section stepCount should match its steps');
// hybrid 折叠：唯一/最后一个小节默认展开。
assert(toolSection.defaultOpen === true, 'the last work-process section should default to expanded (hybrid fold)');

const globRow = flatRows.find((row) => row.type === 'tool' && row.toolName === 'glob');
const readRow = flatRows.find((row) => row.type === 'tool' && row.toolName === 'read_file');
assert(readRow, 'read_file tool row missing');
assert(readRow.previewLines.some((line) => line.includes('"name": "rdc-agent"')), 'json-ish read_file result was not unwrapped');
assert(readRow.previewLines.some((line) => line.includes('"version": "1.0.0"')), 'json-ish read_file result was truncated');
assert(!readRow.previewLines.join('\n').includes('"ok"'), 'json-ish raw JSON leaked into read_file preview');
assert(!readRow.previewLines.join('\n').includes('->'), 'read_file preview should strip line-number gutters');
assert(globRow, 'glob tool row missing');
assert(globRow.verb === '已列出', 'glob row should use the localized compact transcript verb');
assert(globRow.previewLines.some((line) => line.includes('src/main/index.ts')), 'glob result preview was not unwrapped');
assert(!globRow.previewLines.join('\n').includes('"ok"'), 'raw JSON leaked into tool result preview');
assert(globRow.rawLines.join('\n').includes('"ok": true'), 'raw JSON was not preserved in raw details');
assert(readRow.previewLines.length <= 6, 'read_file preview should stay compact');

assert(presentation.defaultExpanded === true, 'complete trace should default to expanded');
assert(presentation.stepCount === 3, `expected 3 transcript steps, got ${presentation.stepCount}`);
assert(presentation.toolCount === 2, `expected 2 tool steps, got ${presentation.toolCount}`);

// hybrid 折叠：多轮时只有最后一个小节默认展开，旧轮折叠回标题。
const multiRoundPresentation = buildWorkProcessPresentation({
  status: 'complete',
  updatedAt: now + 9500,
  blocks: [
    {
      id: 'runtime-segment-1',
      kind: 'tool',
      title: '工具调用',
      status: 'complete',
      summary: '先读取配置。',
      toolCalls: [
        { id: 's1-read', toolName: 'read_file', status: 'complete', argsPreview: JSON.stringify({ path: 'a.ts' }), startedAt: now + 100, completedAt: now + 120 },
      ],
      startedAt: now + 100,
      completedAt: now + 120,
    },
    {
      id: 'runtime-segment-2',
      kind: 'tool',
      title: '工具调用',
      status: 'complete',
      summary: '再检索来源。',
      toolCalls: [
        { id: 's2-glob', toolName: 'glob', status: 'complete', argsPreview: JSON.stringify({ pattern: '*.ts' }), startedAt: now + 200, completedAt: now + 220 },
      ],
      startedAt: now + 200,
      completedAt: now + 220,
    },
  ],
});
const multiSections = multiRoundPresentation.rows.filter((row) => row.type === 'section');
assert(multiSections.length === 2, `expected 2 round sections, got ${multiSections.length}`);
assert(multiSections[0].defaultOpen === false, 'older round section should default to collapsed');
assert(multiSections[1].defaultOpen === true, 'latest round section should default to expanded');
assert(multiSections[0].narration === '先读取配置。', 'section narration should map from block.summary');
assert(multiSections[1].narration === '再检索来源。', 'latest section narration should map from block.summary');

// 用例 1：segment 含 narration → section 展示 teaser 文本。
const narrationTeaserPresentation = buildWorkProcessPresentation({
  status: 'complete',
  updatedAt: now + 9700,
  blocks: [
    {
      id: 'runtime-segment-1',
      kind: 'tool',
      title: '工具调用',
      status: 'complete',
      summary: '先检查 package.json 再决定读取范围。',
      toolCalls: [
        { id: 'narr-read', toolName: 'read_file', status: 'complete', argsPreview: JSON.stringify({ path: 'package.json' }), startedAt: now + 100, completedAt: now + 120 },
      ],
      startedAt: now + 100,
      completedAt: now + 120,
    },
  ],
});
const narrationSection = narrationTeaserPresentation.rows.find((row) => row.type === 'section');
assert(narrationSection?.type === 'section', 'narration segment should render as section');
assert(narrationSection.primaryText.includes('package.json'), 'section primary should surface narration text');
assert(narrationSection.primaryMode === 'result', 'narration-only section should use result mode');

// 用例 2：无 narration 有 thinking → teaser 来自 thinking，detail 保留全文。
const thinkingTeaserPresentation = buildWorkProcessPresentation({
  status: 'complete',
  updatedAt: now + 9800,
  blocks: [
    {
      id: 'runtime-segment-2',
      kind: 'tool',
      title: '工具调用',
      status: 'complete',
      summary: '',
      detail: 'I need to inspect the repository tree before choosing files to read.',
      toolCalls: [
        { id: 'think-glob', toolName: 'glob', status: 'complete', argsPreview: JSON.stringify({ pattern: 'src/**/*.ts' }), startedAt: now + 200, completedAt: now + 220 },
      ],
      startedAt: now + 200,
      completedAt: now + 220,
    },
  ],
});
const thinkingSection = thinkingTeaserPresentation.rows.find((row) => row.type === 'section');
assert(thinkingSection?.type === 'section', 'thinking-only segment should render as section');
assert(thinkingSection.narration === '', 'thinking-only segment should not fabricate narration');
assert(thinkingSection.thinking.includes('repository tree'), 'thinking detail should remain on section row');
assert(thinkingSection.primaryText.includes('repository tree'), 'thinking-only section primary should use thinking text');
assert(thinkingSection.primaryMode === 'thinking-full', 'unspecified thinking presentation should default to full CoT');

// 用例 3：assistant.completed 回填覆盖 tool-time 空 snapshot。
const backfillPresentation = buildWorkProcessPresentation({
  status: 'complete',
  updatedAt: now + 9900,
  blocks: [
    {
      id: 'runtime-segment-3',
      kind: 'tool',
      title: '工具调用',
      status: 'complete',
      summary: 'Turn-end narration replaced the empty tool-time snapshot.',
      detail: 'Provider reasoning summary for this turn.',
      thinkingPresentation: 'summary',
      toolCalls: [
        { id: 'backfill-read', toolName: 'read_file', status: 'complete', argsPreview: JSON.stringify({ path: 'README.md' }), startedAt: now + 300, completedAt: now + 320 },
      ],
      startedAt: now + 300,
      completedAt: now + 320,
    },
  ],
});
const backfillSection = backfillPresentation.rows.find((row) => row.type === 'section');
assert(backfillSection?.type === 'section', 'backfilled segment should render as section');
assert(backfillSection.primaryText.includes('Provider reasoning'), 'thinking should win primary text when both narration and thinking exist');
assert(backfillSection.primaryMode === 'thinking-summary', 'provider summary thinking should use summary mode');
assert(backfillSection.clampPrimary === true, 'summary mode should clamp primary text');

// runtime-reasoning（“整理思路”块）不再渲染成游离行，think 由轮标题统一承载。
const reasoningFiltered = buildWorkProcessPresentation({
  status: 'complete',
  updatedAt: now + 9600,
  blocks: [
    {
      id: 'runtime-reasoning',
      kind: 'reasoning',
      title: '整理思路',
      status: 'complete',
      summary: '整理思路',
      toolCalls: [],
      startedAt: now + 300,
      completedAt: now + 320,
    },
  ],
});
assert(reasoningFiltered.rows.length === 0, 'runtime-reasoning block must be filtered out of the transcript');

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
const blockedRow = flattenRows(blockedPresentation.rows).find((row) => row.type === 'tool');
assert(blockedRow?.type === 'tool', 'blocked write_file row missing');
assert(blockedRow.status === 'error', 'approval-blocked write_file should render as failed');
assert(blockedRow.verb === '已阻止', 'approval-blocked write_file should render as the localized blocked verb');

const askUserPresentation = buildWorkProcessPresentation({
  status: 'running',
  updatedAt: now + 6000,
  blocks: [
    {
      id: 'tool-ask-user',
      kind: 'user_input',
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
assert(askUserRow.verb === '询问用户', 'pending ask_user should render as the localized asked-user verb');
assert(askUserRow.question.includes('Which smoke path'), 'ask_user question should be visible');
const askUserVisible = [askUserRow.verb, askUserRow.question].join(' ');
for (const forbidden of ['ask_user', '"choices"', 'Read-only smoke', 'Edit smoke', 'User input requested by']) {
  assert(!askUserVisible.includes(forbidden), `ask_user visible transcript leaked debug/raw text: ${forbidden}`);
}
assert(askUserRow.detailLines.some((line) => line.includes('选项 1：Read-only smoke')), 'ask_user choices should remain available in details');

const answeredAskUserPresentation = buildWorkProcessPresentation({
  status: 'complete',
  updatedAt: now + 7000,
  blocks: [
    {
      id: 'tool-ask-user-answered',
      kind: 'user_input',
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
assert(answeredAskRow.verb === '已回答', 'answered ask_user should render as the localized answered verb');
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
// running 审批由 Composer 的批准面板独占承担，不再在 work process 中重复成行（避免重复与 JSON 泄漏）。
const toolApprovalRow = toolApprovalPresentation.rows.find((row) => row.type === 'approval');
assert(toolApprovalRow === undefined, 'pending tool approval is owned by the composer panel and must not duplicate as a work-process row');
assert(
  !toolApprovalPresentation.rows.some((row) => JSON.stringify(row).includes('"toolCallId"')),
  'pending approval internal JSON must not leak into the work-process transcript',
);

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
assert(autoReviewRow.verb === '自动审查已拒绝', 'auto-review denial should render with the localized reviewer semantics');
assert(autoReviewRow.message.includes('Auto-review denied'), 'auto-review decision text should be visible');

// 已解决的用户审批：complete 状态全部跳过（审批结果已隐含在工具行记录中，不需要独立顶层行）。
const resolvedApprovalPresentation = buildWorkProcessPresentation({
  status: 'complete',
  updatedAt: now + 7700,
  blocks: [
    {
      id: 'runtime-approval-resolved-tool-1',
      kind: 'approval',
      title: '审批结果',
      status: 'complete',
      summary: '审批状态：approved',
      detail: JSON.stringify('已批准一次'),
      toolCalls: [],
      startedAt: now + 4500,
      completedAt: now + 4520,
    },
  ],
});
const resolvedApprovalRow = resolvedApprovalPresentation.rows.find((row) => row.type === 'approval');
assert(resolvedApprovalRow === undefined, 'complete approval must be skipped entirely — it is already implied by the tool row that triggered it');
assert(
  !resolvedApprovalPresentation.rows.some((row) => JSON.stringify(row).includes('"已批准一次"')),
  'resolved approval internal text must not leak into the work-process transcript',
);

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
const planArtifactRow = flattenRows(planArtifactPresentation.rows).find((row) => row.type === 'tool');
assert(planArtifactRow?.type === 'tool', 'plan_artifact row missing');
assert(planArtifactRow.verb === '已写入', 'plan_artifact should render as the localized write transcript action');
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
const truncatedPayloadRow = flattenRows(truncatedPayloadPresentation.rows).find((row) => row.type === 'tool');
assert(truncatedPayloadRow?.type === 'tool', 'truncated plan_artifact row missing');
assert(truncatedPayloadRow.target === '', 'invalid raw content JSON must not render as a visible target');

const fs = require('node:fs');
const componentSource = [
  fs.readFileSync('src/renderer/features/debugger/AgentChat/WorkProcess.tsx', 'utf8'),
  fs.readFileSync('src/renderer/features/debugger/AgentChat/WorkProcessRows.tsx', 'utf8'),
].join('\n');
const cssSource = fs.readFileSync('src/renderer/features/debugger/AgentChat/AgentChat.css', 'utf8');
const messageActionsSource = fs.readFileSync('src/renderer/features/debugger/AgentChat/MessageActions.tsx', 'utf8');
const messageVariantNavigatorSource = fs.readFileSync('src/renderer/features/debugger/AgentChat/MessageVariantNavigator.tsx', 'utf8');
const messageBubbleSource = fs.readFileSync('src/renderer/features/debugger/AgentChat/MessageBubble.tsx', 'utf8');
const userInputPanelSource = fs.readFileSync('src/renderer/features/debugger/composer/UserInputRequestPanel.tsx', 'utf8');
const userInputSubmitHookSource = fs.readFileSync('src/renderer/features/debugger/composer/useUserInputRequestSubmit.ts', 'utf8');
const toolApprovalPanelSource = fs.readFileSync('src/renderer/features/debugger/composer/ToolApprovalRequestPanel.tsx', 'utf8');
const toolApprovalSubmitHookSource = fs.readFileSync('src/renderer/features/debugger/composer/useToolApprovalSubmit.ts', 'utf8');
const orchestratorSource = fs.readFileSync('src/main/workflow/debugger/AgentOrchestrator.ts', 'utf8');

assert(componentSource.includes('<div className={`work-process-tool status-${row.status}`}>'), 'tool row should render as a fixed transcript block');
assert(componentSource.includes('work-process-disclosure'), 'tool/detail rows should use the whole-row disclosure (no separate Details button)');
assert(componentSource.includes('work-process-row-caret'), 'disclosure rows should expose an expand caret on the row header');
assert(!componentSource.includes("t('chat.workProcessDetails')"), 'the standalone localized Details toggle should be removed in favor of whole-row expansion');
assert(!componentSource.includes("t('chat.workProcessSteps'"), 'work-process header must not show a redundant step count (tools-only metric)');
assert(componentSource.includes('hasExpandableContent'), 'compact tool rows must still support expandable disclosure');
assert(componentSource.includes('work-process-result-preview'), 'compact tool rows must use lightweight result preview');
assert(componentSource.includes('open={autoOpen}'), 'tool rows should auto-expand while running or on error');
assert(componentSource.includes('row.defaultOpen'), 'section rows should honor the hybrid defaultOpen flag');
assert(componentSource.includes('work-process-section'), 'tool calls should be grouped into a collapsible work-process section');
assert(componentSource.includes("t('chat.workProcessViewSteps'"), 'section should expose a localized "view N steps" toggle');
assert(componentSource.includes('work-process-steps-eye'), 'section steps toggle should use an eye icon');
assert(componentSource.includes('work-process-segment-primary'), 'section should render unified primary prose');
assert(componentSource.includes('work-process-steps-toggle'), 'section should use cursor-style steps toggle');
assert(!componentSource.includes("t('chat.workProcessRound'"), 'section must not render round labels');
assert(!componentSource.includes("t('chat.workProcessThinking'"), 'section must not render separate thinking disclosure');
assert(!componentSource.includes("t('chat.workProcessSection'"), 'section must not fall back to synthetic step-count narration');
assert(componentSource.includes('WorkProcessRailIcon'), 'work process should use layered rail icons');
const workProcessRailIconSource = fs.readFileSync('src/renderer/features/debugger/AgentChat/WorkProcessRailIcon.tsx', 'utf8');
assert(!workProcessRailIconSource.includes('CheckGlyph'), 'rail icon should not render check glyph');
assert(!workProcessRailIconSource.includes('work-process-rail-check'), 'rail icon should not use check class');
assert(componentSource.includes('is-thinking'), 'section primary should distinguish thinking prose');
assert(cssSource.includes('.work-process-segment-primary.is-thinking'), 'thinking sections should use caption styling');
assert(cssSource.includes('.conversation-bubble-assistant .markdown-body'), 'assistant markdown should use tighter spacing');
assert(componentSource.includes('variant="section"'), 'section rows should use section rail variant');
assert(componentSource.includes('variant="step"'), 'step rows should use step rail variant');
assert(!cssSource.includes('work-process-segment-primary::before'), 'section primary must not render a secondary bullet');
assert(componentSource.includes('work-process-console'), 'tool output should render as a console card');
assert(componentSource.includes('work-process-user-input'), 'ask_user should have a dedicated user input transcript row');
assert(componentSource.includes('work-process-approval'), 'tool approval should have a dedicated transcript row');
assert(cssSource.includes('.work-process-disclosure:not([open]) > :not(summary)'), 'closed Work Process disclosure must not render expanded body content');
assert(cssSource.includes('.work-process-console'), 'console card styling should exist');
assert(cssSource.includes('.work-process-debug-toggle'), 'debug toggle styling should exist');
assert(cssSource.includes('.work-process-segment-primary'), 'segment primary prose styling should exist');
assert(cssSource.includes('.work-process-steps-toggle'), 'cursor-style steps toggle styling should exist');
assert(messageActionsSource.includes('MessageVariantNavigator'), 'user messages should expose variant navigator');
assert(messageVariantNavigatorSource.includes('message-variant-navigator'), 'variant navigator should render navigator chrome');
assert(!cssSource.includes('.work-process-row-detail'), 'legacy row-detail CSS class should be removed');
assert(!cssSource.includes('WorkProcess v2 - linear agent trace'), 'legacy Work Process CSS block should be removed');
assert(!cssSource.includes('work-process-tool-raw'), 'legacy raw-result CSS class should be removed');
assert(messageBubbleSource.includes('Next actions'), 'handoff actions should render with a low-noise Next actions label');
assert(!messageBubbleSource.includes('<small>{resolveAgentDisplay'), 'handoff button should not render target agent as visible small text');
assert(!userInputPanelSource.includes('window.electronAPI'), 'composer user input panel must not call Electron APIs directly');
assert(userInputSubmitHookSource.includes('answerUserInput'), 'composer user input hook must submit through conversation.answerUserInput');
assert(!toolApprovalPanelSource.includes('window.electronAPI'), 'composer tool approval panel must not call Electron APIs directly');
assert(toolApprovalSubmitHookSource.includes('answerToolApproval'), 'composer tool approval hook must submit through conversation.answerToolApproval');
assert(!orchestratorSource.includes('User input requested by'), 'ask_user tool must not return fake user-request text immediately');

const markdownSource = fs.readFileSync('src/renderer/features/debugger/AgentChat/MessageMarkdown.tsx', 'utf8');
const normalizeMarkdownSource = fs.readFileSync('src/renderer/features/debugger/AgentChat/normalizeAssistantMarkdown.ts', 'utf8');
assert(markdownSource.includes('normalizeAssistantMarkdown'), 'assistant markdown must normalize pseudo-list content');
assert(normalizeMarkdownSource.includes('◦'), 'markdown normalizer must handle pseudo bullet characters');
assert(cssSource.includes('list-style-type: disc'), 'markdown body must style unordered lists');

console.log('[work-process] OK');
