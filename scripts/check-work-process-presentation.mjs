import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
require('./register-ts-source.cjs');

const { buildWorkProcessPresentation, normalizeWorkProcessText } = require('../src/renderer/features/debugger/AgentChat/workProcessPresentation.ts');
const { normalizeAssistantMarkdown } = require('../src/renderer/features/debugger/AgentChat/normalizeAssistantMarkdown.ts');

const now = 1_700_000_000_000;

const fail = (message) => {
  console.error(`[work-process] ${message}`);
  process.exit(1);
};

const assert = (condition, message) => {
  if (!condition) fail(message);
};

const flattenRows = (rows) => rows.flatMap((row) => (
  row.type === 'section' ? [row, ...flattenRows(row.steps)] : [row]
));

const collectVisible = (rows) => rows.flatMap((row) => {
  if (row.type === 'section') return [
    row.resultText,
    row.resultToolSummary,
    row.thinkingLabel,
    row.thinkingSource,
    ...collectVisible(row.steps),
  ].filter(Boolean);
  if (row.type === 'tool') return [
    row.verb,
    row.toolName,
    row.target,
    row.approval?.verb,
    row.approval?.message,
    ...(row.approval?.metaLines ?? []),
    ...row.previewLines,
  ].filter(Boolean);
  if (row.type === 'userInput') return [row.verb, row.question];
  if (row.type === 'approval') return [row.verb, row.message, ...row.metaLines];
  if (row.type === 'diagnostic') return [row.message];
  if (row.type === 'summary') return [row.text];
  return [];
});

assert(
  normalizeWorkProcessText('  line one  \n\n\n\nline two  ') === 'line one\n\nline two',
  'work-process text should collapse excessive blank lines',
);

const normalizedMarkdown = normalizeAssistantMarkdown('Summary:\n\n- **Who:** Edit\n\n\n- **Use:** help');
assert(normalizedMarkdown.includes('### Summary'), 'markdown normalizer should promote section headings');
assert(!normalizedMarkdown.includes('\n\n\n'), 'markdown normalizer should remove triple blank gaps');

const presentation = buildWorkProcessPresentation({
  status: 'complete',
  summary: 'Reply completed.',
  updatedAt: now + 4000,
  blocks: [
    {
      id: 'runtime-run',
      kind: 'reasoning',
      title: 'Agent Loop complete',
      status: 'complete',
      summary: 'Model and tool loop completed.',
      detail: 'Model: kimi-code',
      toolCalls: [],
      startedAt: now,
      completedAt: now + 3000,
    },
    {
      id: 'runtime-loop-1',
      kind: 'llm_turn',
      title: 'LLM turn',
      status: 'complete',
      result: {
        text: 'Read files before answering.',
        status: 'complete',
        toolCallIds: ['tool-read', 'tool-glob'],
      },
      toolCalls: [
        {
          id: 'tool-read',
          toolName: 'read_file',
          status: 'complete',
          argsPreview: JSON.stringify({ path: 'package.json' }),
          resultPreview: String.raw`{"ok":true,"data":{"content":[{"type":"text","text":"     1->{\n     2->  \"name\": \"rdc-agent\",\n     3->  \"version\": \"1.0.0\",\n     4->  \"description\": \"RenderDoc Debug Agent - Vertical Framework\"`,
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
            data: { content: [{ type: 'text', text: 'src/main/index.ts\nsrc/main/conversation\nsrc/main/workflow' }] },
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
      title: 'Generate final answer',
      status: 'complete',
      summary: 'Final answer generated.',
      toolCalls: [],
      startedAt: now + 800,
      completedAt: now + 900,
    },
  ],
});

const flatRows = flattenRows(presentation.rows);
const visibleText = collectVisible(presentation.rows).join('\n');
for (const forbidden of ['Agent Loop complete', 'Generate final answer', 'Final answer generated.', '"path": "package.json"']) {
  assert(!visibleText.includes(forbidden), `visible transcript leaked noisy label: ${forbidden}`);
}
const loopSection = presentation.rows.find((row) => row.type === 'section');
assert(loopSection?.type === 'section', 'llm turn should render a work-process section');
assert(loopSection.resultText === 'Read files before answering.', 'loop result must render model output');
assert(loopSection.resultToolSummary === 'Requested 2 tools: read_file, glob.', 'loop result should summarize requested tools');
assert(loopSection.resultStreaming === false, 'completed result should not be marked streaming');
assert(loopSection.thinkingLabel === '', 'no-thinking model should not render thinking row');
assert(loopSection.steps.length === 2, 'loop section should contain tool execution rows');
assert(loopSection.defaultOpen === true, 'latest work-process section should default to expanded');
const globRow = flatRows.find((row) => row.type === 'tool' && row.toolName === 'glob');
const readRow = flatRows.find((row) => row.type === 'tool' && row.toolName === 'read_file');
assert(readRow?.previewLines.some((line) => line.includes('"name": "rdc-agent"')), 'read_file result was not unwrapped');
assert(!readRow.previewLines.join('\n').includes('->'), 'read_file preview should strip line-number gutters');
assert(globRow?.verb === 'Listed files', 'glob row should use compact transcript verb');
assert(presentation.stepCount === 3, `expected 3 visible work steps, got ${presentation.stepCount}`);
assert(presentation.toolCount === 2, `expected 2 tool steps, got ${presentation.toolCount}`);

const rawThinkingPresentation = buildWorkProcessPresentation({
  status: 'complete',
  updatedAt: now + 9800,
  blocks: [
    {
      id: 'runtime-loop-raw',
      kind: 'llm_turn',
      title: 'LLM turn',
      status: 'complete',
      result: { text: 'Tool result reviewed.', status: 'complete', toolCallIds: ['think-glob'] },
      thinking: {
        text: 'hidden chain-of-thought that must not be visible',
        kind: 'raw',
        source: 'openai-compatible-raw',
        visibility: 'raw-collapsed',
        replayPolicy: 'none',
      },
      thinkingStatus: 'complete',
      toolCalls: [{ id: 'think-glob', toolName: 'glob', status: 'complete', argsPreview: JSON.stringify({ pattern: 'src/**/*.ts' }), startedAt: now + 200, completedAt: now + 220 }],
      startedAt: now + 200,
      completedAt: now + 220,
    },
  ],
});
const rawThinkingSection = rawThinkingPresentation.rows.find((row) => row.type === 'section');
assert(rawThinkingSection?.type === 'section', 'raw thinking loop should render a section');
assert(rawThinkingSection.resultText === 'Tool result reviewed.', 'raw thinking must not replace loop result');
assert(rawThinkingSection.thinkingLabel === 'Thought', 'completed raw thinking should be labeled thought');
assert(rawThinkingSection.thinkingExpandable === true, 'raw thinking should be collapsed and expandable');
assert(rawThinkingSection.thinkingOpenByDefault === false, 'raw thinking should stay folded by default');
assert(!collectVisible(rawThinkingPresentation.rows).join('\n').includes('hidden chain-of-thought'), 'visible transcript must not leak raw thinking');

const streamingSummaryPresentation = buildWorkProcessPresentation({
  status: 'running',
  updatedAt: now + 9950,
  blocks: [
    {
      id: 'runtime-loop-streaming-summary',
      kind: 'llm_turn',
      title: 'LLM turn',
      status: 'running',
      result: { text: 'I found the relevant files.', status: 'streaming', toolCallIds: [] },
      thinking: {
        text: 'Planning the next tool call.',
        kind: 'summary',
        source: 'openai-responses-summary',
        visibility: 'summary',
        replayPolicy: 'none',
      },
      thinkingStatus: 'streaming',
      toolCalls: [],
      startedAt: now + 330,
    },
  ],
});
const streamingSummarySection = streamingSummaryPresentation.rows.find((row) => row.type === 'section');
assert(streamingSummarySection?.type === 'section', 'streaming summary section missing');
assert(streamingSummarySection.thinkingLabel === 'Thinking', 'streaming thinking should use active label');
assert(streamingSummarySection.thinkingOpenByDefault === true, 'streaming summary should open by default');
assert(streamingSummarySection.resultText === 'I found the relevant files.', 'result should stream below thinking');
assert(streamingSummarySection.resultStreaming === true, 'streaming loop result should be marked streaming');

const completedSummaryPresentation = buildWorkProcessPresentation({
  status: 'complete',
  updatedAt: now + 9960,
  blocks: [
    {
      id: 'runtime-loop-complete-summary',
      kind: 'llm_turn',
      title: 'LLM turn',
      status: 'complete',
      result: { text: 'Turn-end result.', status: 'complete', toolCallIds: [] },
      thinking: {
        text: 'Provider reasoning summary for this turn.',
        kind: 'summary',
        source: 'openai-responses-summary',
        visibility: 'summary',
        replayPolicy: 'none',
      },
      thinkingStatus: 'complete',
      toolCalls: [],
      startedAt: now + 340,
      completedAt: now + 350,
    },
  ],
});
const completedSummarySection = completedSummaryPresentation.rows.find((row) => row.type === 'section');
assert(completedSummarySection?.type === 'section', 'completed summary section missing');
assert(completedSummarySection.thinkingLabel === 'Thought', 'completed summary should use complete label');
assert(completedSummarySection.thinkingOpenByDefault === false, 'completed summary thinking should be folded');
assert(completedSummarySection.resultText === 'Turn-end result.', 'completed summary thinking must not replace result');

const opaquePresentation = buildWorkProcessPresentation({
  status: 'complete',
  updatedAt: now + 9970,
  blocks: [
    {
      id: 'runtime-loop-opaque',
      kind: 'llm_turn',
      title: 'LLM turn',
      status: 'complete',
      result: { text: 'Provider state retained.', status: 'complete', toolCallIds: [] },
      thinking: {
        kind: 'opaque',
        source: 'openai-responses-encrypted',
        visibility: 'hidden',
        replayPolicy: 'provider-artifact',
        artifact: { providerId: 'openai', protocol: 'responses', type: 'reasoning', encryptedContent: 'sealed' },
      },
      thinkingStatus: 'complete',
      toolCalls: [],
      startedAt: now + 350,
      completedAt: now + 360,
    },
  ],
});
const opaqueSection = opaquePresentation.rows.find((row) => row.type === 'section');
assert(opaqueSection?.type === 'section', 'opaque thinking section missing');
assert(opaqueSection.thinkingLabel === 'Provider continuation state retained', 'opaque artifact should expose safe status only');
assert(opaqueSection.thinkingExpandable === false, 'opaque artifact must not expand plaintext');
assert(opaqueSection.thinkingPreview === '', 'opaque artifact must not render preview text');

const approvalPresentation = buildWorkProcessPresentation({
  status: 'running',
  updatedAt: now + 7500,
  blocks: [
    {
      id: 'runtime-loop-tool-approval',
      kind: 'llm_turn',
      title: 'LLM turn',
      status: 'running',
      result: { status: 'complete', toolCallIds: ['tool-1'] },
      toolCalls: [
        {
          id: 'tool-1',
          toolName: 'web_search',
          status: 'running',
          argsPreview: JSON.stringify({ query: 'latest Claude news' }),
          resultPreview: JSON.stringify({ ok: false, error: { message: 'approval required' } }),
          approval: {
            approvalId: 'tool-approval-tool-1',
            status: 'pending',
            reason: 'Network tool "web_search" requires approval in the current permission mode.',
            risk: 'medium',
            reviewer: 'auto_review',
          },
          startedAt: now + 4300,
        },
      ],
      startedAt: now + 4300,
    },
  ],
});
const approvalRows = flattenRows(approvalPresentation.rows);
const approvalRow = approvalRows.find((row) => row.type === 'tool' && row.toolName === 'web_search');
assert(!approvalRows.some((row) => row.type === 'approval'), 'pending tool approval should not render as top-level approval row');
assert(approvalRow?.approval?.verb === 'Auto-reviewing', 'pending auto-review should use reviewer semantics');
assert(approvalRow.approval.message.includes('web_search'), 'pending approval reason should be visible inside tool row');
assert(approvalRow.previewLines.length === 0, 'approval-required intermediate errors should not render as result previews');

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
          argsPreview: JSON.stringify({ question: 'Which smoke path should I use?', choices: ['Read-only smoke', 'Edit smoke'] }),
          startedAt: now + 3000,
        },
      ],
      startedAt: now + 3000,
    },
  ],
});
const askUserRow = askUserPresentation.rows.find((row) => row.type === 'userInput');
assert(askUserRow?.type === 'userInput', 'ask_user should render as a user input row');
assert(askUserRow.verb === 'Asked user', 'pending ask_user should render asked-user verb');
assert(askUserRow.question.includes('Which smoke path'), 'ask_user question should be visible');
assert(askUserRow.detailLines.some((line) => line.includes('Option 1: Read-only smoke')), 'ask_user choices should stay in details');

const webSearchPresentation = buildWorkProcessPresentation({
  status: 'complete',
  updatedAt: now + 9100,
  blocks: [
    {
      id: 'runtime-loop-web',
      kind: 'llm_turn',
      title: 'LLM turn',
      status: 'complete',
      result: { text: 'Search the web.', status: 'complete', toolCallIds: ['tool-web-search'] },
      toolCalls: [
        {
          id: 'tool-web-search',
          toolName: 'web_search',
          status: 'complete',
          argsPreview: JSON.stringify({ query: 'RenderDoc' }),
          resultPreview: JSON.stringify({
            ok: true,
            data: {
              content: [{ type: 'text', text: 'Search query: RenderDoc' }],
              details: { kind: 'search', provider: 'DuckDuckGo HTML', resultCount: 1, results: [{ title: 'RenderDoc', url: 'https://renderdoc.org/', snippet: 'Graphics debugger.' }] },
            },
          }),
          startedAt: now + 7000,
          completedAt: now + 7020,
        },
      ],
      startedAt: now + 7000,
      completedAt: now + 7020,
    },
  ],
});
const webSearchRow = flattenRows(webSearchPresentation.rows).find((row) => row.type === 'tool' && row.toolName === 'web_search');
assert(webSearchRow?.verb === 'Searched web', 'web_search should use dedicated web search verb');
assert(webSearchRow.previewLines.includes('Provider: DuckDuckGo HTML'), 'web_search preview should include provider');
assert(webSearchRow.previewLines.includes('https://renderdoc.org/'), 'web_search preview should include first result URL');

const componentSource = [
  fs.readFileSync('src/renderer/features/debugger/AgentChat/WorkProcess.tsx', 'utf8'),
  fs.readFileSync('src/renderer/features/debugger/AgentChat/WorkProcessRows.tsx', 'utf8'),
].join('\n');
const cssSource = fs.readFileSync('src/renderer/features/debugger/AgentChat/AgentChat.css', 'utf8');
const presentationSource = fs.readFileSync('src/renderer/features/debugger/AgentChat/workProcessPresentation.ts', 'utf8');
const i18nSource = fs.readFileSync('src/renderer/i18n.ts', 'utf8');
const userInputPanelSource = fs.readFileSync('src/renderer/features/debugger/composer/UserInputRequestPanel.tsx', 'utf8');
const userInputSubmitHookSource = fs.readFileSync('src/renderer/features/debugger/composer/useUserInputRequestSubmit.ts', 'utf8');
const toolApprovalPanelSource = fs.readFileSync('src/renderer/features/debugger/composer/ToolApprovalRequestPanel.tsx', 'utf8');
const toolApprovalSubmitHookSource = fs.readFileSync('src/renderer/features/debugger/composer/useToolApprovalSubmit.ts', 'utf8');
const orchestratorSource = fs.readFileSync('src/main/workflow/debugger/AgentOrchestrator.ts', 'utf8');

assert(presentationSource.includes("block.kind === 'llm_turn'"), 'Work Process sections should be sourced from LLM loop blocks');
assert(!presentationSource.includes("block.kind === 'tool'"), 'renderer must not consume legacy tool blocks as sections');
assert(componentSource.includes('<div className={resultClassName}>'), 'section should render loop result block');
assert(componentSource.indexOf('{row.thinkingExpandable ?') < componentSource.indexOf('{hasResult ?'), 'thinking disclosure must render before result');
assert(componentSource.includes('row.resultToolSummary'), 'loop result should expose requested-tool summary');
assert(componentSource.includes('work-process-disclosure'), 'tool/detail rows should use the whole-row disclosure');
assert(componentSource.includes('work-process-row-caret'), 'disclosure rows should expose an expand caret');
assert(componentSource.includes('work-process-result-preview'), 'compact tool rows must use result preview');
assert(componentSource.includes('open={autoOpen}'), 'tool rows should auto-expand while running or on error');
assert(componentSource.includes('row.defaultOpen'), 'section rows should honor defaultOpen');
assert(componentSource.includes('row.resultStreaming'), 'section rows should render result streaming state');
assert(componentSource.includes('row.thinkingOpenByDefault'), 'section rows should render thinking open state');
assert(componentSource.includes('work-process-section'), 'LLM loops should render grouped sections');
assert(componentSource.includes("t('chat.workProcessViewSteps'"), 'section should expose localized tool-step disclosure');
assert(componentSource.includes('work-process-steps-icon'), 'section steps toggle should use canonical list icon');
assert(!componentSource.includes('work-process-steps-eye'), 'legacy eye icon must be removed');
assert(!componentSource.includes('primaryMode'), 'result/thinking order must not depend on primaryMode');
assert(!componentSource.includes('thinking-full'), 'component must not render full hidden CoT mode');
assert(cssSource.includes('.work-process-thinking-state.status-streaming .work-process-thinking-summary::after'), 'streaming thinking shimmer should exist');
assert(cssSource.includes('@keyframes work-process-thinking-sweep'), 'thinking shimmer keyframes should exist');
assert(cssSource.includes('.work-process-loop-result.is-streaming'), 'result streaming indicator should exist');
assert(cssSource.includes('@media (prefers-reduced-motion: reduce)'), 'streaming motion should honor reduced motion');
assert(cssSource.includes('.work-process-tool-approval'), 'tool approval styling should exist');
assert(cssSource.includes('.work-process-disclosure:not([open]) > :not(summary)'), 'closed disclosure must not render expanded body content');
assert(cssSource.includes('.work-process-console'), 'console card styling should exist');
assert(!cssSource.includes('.work-process-empty'), 'placeholder empty-state CSS should be removed');
assert(!cssSource.includes('work-process-steps-eye'), 'legacy eye-icon CSS should be removed');
assert(!cssSource.includes('is-thinking-full'), 'full hidden CoT styling should be removed');
assert(i18nSource.includes("'chat.workProcessViewSteps': 'Tool steps {count}'"), 'English tool-step disclosure copy should be canonical');
assert(!userInputPanelSource.includes('window.electronAPI'), 'composer user input panel must not call Electron APIs directly');
assert(userInputSubmitHookSource.includes('answerUserInput'), 'composer user input hook must submit through conversation.answerUserInput');
assert(!toolApprovalPanelSource.includes('window.electronAPI'), 'composer tool approval panel must not call Electron APIs directly');
assert(toolApprovalSubmitHookSource.includes('answerToolApproval'), 'composer tool approval hook must submit through conversation.answerToolApproval');
assert(!orchestratorSource.includes('User input requested by'), 'ask_user tool must not return fake user-request text immediately');

console.log('[work-process] OK');
