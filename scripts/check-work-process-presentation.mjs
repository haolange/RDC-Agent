import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
require('./register-ts-source.cjs');

const {
  buildWorkProcessPresentation,
  normalizeWorkProcessText,
} = require('../src/renderer/features/debugger/AgentChat/workProcessPresentation.ts');
const { normalizeAssistantMarkdown } = require('../src/renderer/features/debugger/AgentChat/normalizeAssistantMarkdown.ts');

const now = 1_700_000_000_000;

const fail = (message) => {
  console.error(`[work-process] ${message}`);
  process.exit(1);
};

const assert = (condition, message) => {
  if (!condition) fail(message);
};

const readSource = (path) => fs.readFileSync(path, 'utf8');
const activeSignalSource = readSource('src/renderer/ui/ActiveSignalText.tsx');
const activeSignalStyles = readSource('src/renderer/styles/design-system.css');
const activeSignalHelper = readSource('src/renderer/features/debugger/AgentChat/workProcessActiveSignal.ts');
const activeSignalRenderSource = [
  'src/renderer/features/debugger/AgentChat/WorkProcessSectionRow.tsx',
  'src/renderer/features/debugger/AgentChat/WorkProcessStepGroupRow.tsx',
  'src/renderer/features/debugger/AgentChat/WorkProcessRows.tsx',
  'src/renderer/features/debugger/AgentChat/WorkProcessResponseRow.tsx',
  'src/renderer/features/debugger/AgentChat/SubagentRow.tsx',
  'src/renderer/features/debugger/AgentChat/TaskRow.tsx',
  'src/renderer/features/debugger/composer/UserInputRequestPanel.tsx',
  'src/renderer/features/debugger/composer/ToolApprovalRequestPanel.tsx',
].map(readSource).join('\n');

assert(activeSignalSource.includes('data-active-signal={active ? tone : undefined}'), 'ActiveSignalText should expose an active-state DOM contract');
assert(activeSignalHelper.includes("status === 'running' || status === 'pending'"), 'active signal must be driven by running/pending Work Process status');
assert(activeSignalHelper.includes("thinkingStatus === 'streaming'"), 'active signal must recognize streaming thinking lifecycle');
assert(activeSignalStyles.includes('.active-signal-text.is-active'), 'active signal text CSS class is missing');
assert(activeSignalStyles.includes('@media (prefers-reduced-motion: reduce)'), 'active signal must honor reduced-motion preferences');
assert(activeSignalRenderSource.includes('ActiveSignalText active={active}'), 'Work Process rows should use shared ActiveSignalText for active labels');
assert(activeSignalRenderSource.includes('tone="interaction"'), 'ask_user interaction surfaces should use the interaction active signal tone');
assert(!activeSignalRenderSource.includes("row.status === 'complete' &&"), 'complete rows must not be a trigger for active signal text');

const flattenRows = (rows) => rows.flatMap((row) => {
  if (row.type === 'section') return [row, ...flattenRows(row.steps)];
  if (row.type === 'toolGroup') return [row, ...flattenRows(row.rows)];
  return [row];
});

const collectVisible = (rows) => rows.flatMap((row) => {
  if (row.type === 'section') return [
    row.resultText,
    row.resultToolSummary,
    row.thinkingLabel,
    row.thinkingSource,
    row.thinkingOpenByDefault ? row.thinkingPreview : '',
    ...collectVisible(row.steps),
  ].filter(Boolean);
  if (row.type === 'toolGroup') return [
    row.title,
    row.countLabel,
    row.summary,
    ...collectVisible(row.rows),
  ].filter(Boolean);
  if (row.type === 'response') return [
    row.title,
    row.summary,
    row.thinkingLabel,
    row.thinkingOpenByDefault ? row.thinkingPreview : '',
  ].filter(Boolean);
  if (row.type === 'tool') return [
    row.verb,
    row.toolName,
    row.target,
    row.category,
    row.groupKind,
    row.approval?.verb,
    row.approval?.message,
    ...(row.approval?.metaLines ?? []),
    ...row.previewLines,
  ].filter(Boolean);
  if (row.type === 'userInput') return [
    row.verb,
    ...row.items.flatMap((item) => [item.prompt, item.answer]).filter(Boolean),
  ];
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
  summary: '回复已完成',
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
assert(presentation.summary === '', 'reply-complete trace summary should not render redundant body copy');
for (const forbidden of ['Agent Loop complete', 'Generate final answer', 'Final answer generated.', '"path": "package.json"', 'Called tool']) {
  assert(!visibleText.includes(forbidden), `visible transcript leaked noisy label: ${forbidden}`);
}
const loopSection = presentation.rows.find((row) => row.type === 'section');
assert(loopSection?.type === 'section', 'llm turn should render a work-process section');
assert(loopSection.resultText === 'Read files before answering.', 'tool-backed no-thinking loop should show its direct result');
assert(loopSection.thinkingLabel === '', 'no-thinking loop should not render a fake reasoning label');
assert(loopSection.stepCount === 2, `expected 2 tool actions in section, got ${loopSection.stepCount}`);
assert(loopSection.steps.length === 1 && loopSection.steps[0].type === 'toolGroup', 'loop section should group adjacent file exploration actions');
const explorationGroup = loopSection.steps[0];
assert(explorationGroup.title === '探索', `expected exploration group, got ${explorationGroup.title}`);
assert(explorationGroup.countLabel === '2 文件', `expected file count label, got ${explorationGroup.countLabel}`);
const globRow = flatRows.find((row) => row.type === 'tool' && row.toolName === 'glob');
const readRow = flatRows.find((row) => row.type === 'tool' && row.toolName === 'read_file');
assert(readRow?.verb === '已读取', 'read_file row should use Chinese semantic verb');
assert(globRow?.verb === '已列出', 'glob row should use Chinese semantic verb');
assert(readRow?.previewLines.some((line) => line.includes('"name": "rdc-agent"')), 'read_file result was not unwrapped');
assert(!readRow.previewLines.join('\n').includes('->'), 'read_file preview should strip line-number gutters');
assert(presentation.actionCount === 2, `expected 2 actions, got ${presentation.actionCount}`);

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
        text: 'provider-visible raw thinking',
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
assert(rawThinkingSection.thinkingLabel === '原始思考', 'raw thinking should expose a concrete disclosure label');
assert(rawThinkingSection.thinkingPreview === 'provider-visible raw thinking', 'raw provider thinking should remain available behind disclosure');
assert(rawThinkingSection.thinkingOpenByDefault === false, 'raw thinking should stay folded by default');

const summaryThinkingPresentation = buildWorkProcessPresentation({
  status: 'complete',
  updatedAt: now + 9900,
  blocks: [
    {
      id: 'runtime-loop-summary',
      kind: 'llm_turn',
      title: 'LLM turn',
      status: 'complete',
      result: { text: 'Turn result.', status: 'complete', toolCallIds: [] },
      thinking: {
        text: 'The user asks in Chinese. Now answer in Chinese.',
        kind: 'summary',
        source: 'anthropic-thinking',
        visibility: 'summary',
        replayPolicy: 'provider-artifact',
      },
      thinkingStatus: 'complete',
      toolCalls: [],
      startedAt: now + 225,
      completedAt: now + 230,
    },
  ],
});
const summaryThinkingSection = summaryThinkingPresentation.rows.find((row) => row.type === 'section');
assert(summaryThinkingSection?.type === 'section', 'summary thinking should render as process evidence');
assert(summaryThinkingSection.resultText === '', 'answer-only thinking must not duplicate final answer text');
assert(summaryThinkingSection.thinkingLabel === '思考', 'summary thinking should use a loop-level label distinct from the Work Process header');
assert(summaryThinkingSection.thinkingOpenByDefault === true, 'summary thinking should be open by default');

const duplicateSummary = 'I have all the answers from memory. Let me respond concisely in Chinese.';
const duplicateSummaryPresentation = buildWorkProcessPresentation({
  status: 'complete',
  updatedAt: now + 9965,
  blocks: [
    {
      id: 'runtime-loop-duplicate-before-tools',
      kind: 'llm_turn',
      title: 'LLM turn',
      status: 'complete',
      result: { text: '', status: 'complete', toolCallIds: ['duplicate-tool-read'] },
      thinking: {
        text: duplicateSummary,
        kind: 'summary',
        source: 'anthropic-thinking',
        visibility: 'summary',
        replayPolicy: 'provider-artifact',
      },
      thinkingStatus: 'complete',
      toolCalls: [
        { id: 'duplicate-tool-read', toolName: 'read_file', status: 'complete', argsPreview: JSON.stringify({ path: 'project-identity' }), startedAt: now + 352, completedAt: now + 356 },
      ],
      startedAt: now + 352,
      completedAt: now + 356,
    },
    {
      id: 'runtime-loop-duplicate-after-tools',
      kind: 'llm_turn',
      title: 'LLM turn',
      status: 'complete',
      result: { text: 'Final answer body only.', status: 'complete', toolCallIds: [] },
      thinking: {
        text: duplicateSummary,
        kind: 'summary',
        source: 'anthropic-thinking',
        visibility: 'summary',
        replayPolicy: 'provider-artifact',
      },
      thinkingStatus: 'complete',
      toolCalls: [],
      startedAt: now + 360,
      completedAt: now + 365,
    },
  ],
});
const duplicateSummarySections = duplicateSummaryPresentation.rows.filter((row) => row.type === 'section');
assert(duplicateSummarySections.length === 1, 'duplicate provider summary should not create repeated Work Process sections');
const duplicateSummaryResponses = duplicateSummaryPresentation.rows.filter((row) => row.type === 'response');
assert(duplicateSummaryResponses.length === 1, 'answer-only loop after tools should create one response boundary');
assert(duplicateSummaryResponses[0].thinkingExpandable === false, 'duplicate response summary should be suppressed under the response boundary');
assert(!JSON.stringify(duplicateSummaryResponses[0]).includes('Final answer body only.'), 'response boundary must not duplicate final answer body text');

const streamingResponsePresentation = buildWorkProcessPresentation({
  status: 'running',
  updatedAt: now + 9967,
  blocks: [
    {
      id: 'runtime-loop-response-before-tools',
      kind: 'llm_turn',
      title: 'LLM turn',
      status: 'complete',
      result: { text: 'Read memory before answer.', status: 'complete', toolCallIds: ['response-tool-memory'] },
      thinking: {
        text: 'Read project memory before answering.',
        kind: 'summary',
        source: 'anthropic-thinking',
        visibility: 'summary',
        replayPolicy: 'provider-artifact',
      },
      thinkingStatus: 'complete',
      toolCalls: [
        { id: 'response-tool-memory', toolName: 'memory_read', status: 'complete', argsPreview: JSON.stringify({ key: 'project-identity' }), startedAt: now + 370, completedAt: now + 375 },
      ],
      startedAt: now + 370,
      completedAt: now + 375,
    },
    {
      id: 'assistant-output',
      kind: 'output',
      title: 'Assistant output ready',
      status: 'complete',
      summary: 'Final answer generated.',
      toolCalls: [],
      startedAt: now + 376,
      completedAt: now + 379,
    },
    {
      id: 'runtime-loop-response-final',
      kind: 'llm_turn',
      title: 'LLM turn',
      status: 'running',
      result: { text: 'Streaming final answer tokens.', status: 'streaming', toolCallIds: [] },
      thinking: {
        text: 'Now produce the final answer.',
        kind: 'summary',
        source: 'anthropic-thinking',
        visibility: 'summary',
        replayPolicy: 'provider-artifact',
      },
      thinkingStatus: 'streaming',
      toolCalls: [],
      startedAt: now + 380,
    },
  ],
});
assert(streamingResponsePresentation.rows.map((row) => row.type).join(',') === 'section,response', 'final answer streaming should render one process section plus one response boundary');
const streamingResponse = streamingResponsePresentation.rows.find((row) => row.type === 'response');
assert(streamingResponse?.thinkingOpenByDefault === false, 'final response thinking should be folded by default');
assert(streamingResponse?.thinkingPreview === 'Now produce the final answer.', 'final response summary should stay attached to the response boundary');
assert(!JSON.stringify(streamingResponse).includes('Streaming final answer tokens.'), 'streaming final answer text should stay out of Work Process response rows');

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
assert(!opaquePresentation.rows.find((row) => row.type === 'section'), 'opaque provider state should not render a section row');
assert(opaquePresentation.rows.some((row) => row.type === 'reasoningIndicator'), 'opaque provider state should render a reasoning indicator');

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
assert(approvalRow?.approval?.verb === '自动检查中', 'pending auto-review should use reviewer semantics');
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
          argsPreview: JSON.stringify({
            questions: [{
              questionId: 'smoke-path',
              prompt: 'Which smoke path should I use?',
              options: [
                { optionId: 'read-only', label: 'Read-only smoke' },
                { optionId: 'edit', label: 'Edit smoke' },
              ],
            }, {
              questionId: 'smoke-name',
              prompt: 'What should I call this smoke run?',
              options: [],
            }],
          }),
          startedAt: now + 3000,
        },
      ],
      startedAt: now + 3000,
    },
  ],
});
const askUserRows = flattenRows(askUserPresentation.rows);
const askUserGroup = askUserRows.find((row) => row.type === 'toolGroup');
const askUserRow = askUserRows.find((row) => row.type === 'userInput');
assert(askUserGroup?.title === '正在询问', 'pending ask_user should render in an asking interaction group');
assert(askUserGroup?.countLabel === '2 个问题', `batch ask_user should count real questions, got ${askUserGroup?.countLabel}`);
assert(askUserGroup?.summary === '', 'ask_user group should not duplicate the first question in the header preview');
assert(askUserRow?.verb === '等待用户', 'pending ask_user should render waiting-user verb');
assert(askUserRow.items.length === 2, 'ask_user should expose each batch question as a transcript item');
assert(askUserRow.items[0].prompt.includes('Which smoke path'), 'ask_user first question should be visible');

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
assert(webSearchRow?.verb === '已联网搜索', 'web_search should use dedicated web search verb');
assert(webSearchRow.previewLines.includes('Provider: DuckDuckGo HTML'), 'web_search preview should include provider');
assert(webSearchRow.previewLines.includes('https://renderdoc.org/'), 'web_search preview should include first result URL');

const mcpPresentation = buildWorkProcessPresentation({
  status: 'complete',
  updatedAt: now + 9200,
  blocks: [
    {
      id: 'runtime-loop-mcp',
      kind: 'llm_turn',
      title: 'LLM turn',
      status: 'complete',
      result: { status: 'complete', toolCallIds: ['tool-mcp'] },
      toolCalls: [
        {
          id: 'tool-mcp',
          toolName: 'mcp__filesystem__read_file',
          status: 'complete',
          argsPreview: JSON.stringify({ path: 'README.md' }),
          resultPreview: JSON.stringify({ ok: true }),
          startedAt: now + 7100,
          completedAt: now + 7110,
        },
      ],
      startedAt: now + 7100,
      completedAt: now + 7110,
    },
  ],
});
const mcpRows = flattenRows(mcpPresentation.rows);
const mcpGroup = mcpRows.find((row) => row.type === 'toolGroup');
const mcpRow = mcpRows.find((row) => row.type === 'tool');
assert(mcpGroup?.title === 'MCP · filesystem', 'dynamic MCP tools should group by server');
assert(mcpRow?.target === 'filesystem/read_file', 'dynamic MCP target should show server/tool');

const componentSource = [
  fs.readFileSync('src/renderer/features/debugger/AgentChat/WorkProcess.tsx', 'utf8'),
  fs.readFileSync('src/renderer/features/debugger/AgentChat/WorkProcessSectionRow.tsx', 'utf8'),
  fs.readFileSync('src/renderer/features/debugger/AgentChat/WorkProcessStepGroupRow.tsx', 'utf8'),
  fs.readFileSync('src/renderer/features/debugger/AgentChat/WorkProcessReasoningIndicatorRow.tsx', 'utf8'),
  fs.readFileSync('src/renderer/features/debugger/AgentChat/workProcessRowRenderer.tsx', 'utf8'),
  fs.readFileSync('src/renderer/features/debugger/AgentChat/WorkProcessViewToggle.tsx', 'utf8'),
  fs.readFileSync('src/renderer/features/debugger/AgentChat/WorkProcessRows.tsx', 'utf8'),
  fs.readFileSync('src/renderer/features/debugger/AgentChat/WorkProcessResponseRow.tsx', 'utf8'),
  fs.readFileSync('src/renderer/features/debugger/AgentChat/WorkProcessIcons.tsx', 'utf8'),
].join('\n');
const cssSource = fs.readFileSync('src/renderer/features/debugger/AgentChat/AgentChat.css', 'utf8');
const presentationSource = [
  fs.readFileSync('src/renderer/features/debugger/AgentChat/workProcessPresentation.ts', 'utf8'),
  fs.readFileSync('src/renderer/features/debugger/AgentChat/workProcessBlockProjection.ts', 'utf8'),
  fs.readFileSync('src/renderer/features/debugger/AgentChat/workProcessGrouping.ts', 'utf8'),
  fs.readFileSync('src/renderer/features/debugger/AgentChat/workProcessToolCatalog.ts', 'utf8'),
].join('\n');
const i18nSource = fs.readFileSync('src/renderer/i18n.ts', 'utf8');
const userInputPanelSource = fs.readFileSync('src/renderer/features/debugger/composer/UserInputRequestPanel.tsx', 'utf8');
const userInputSubmitHookSource = fs.readFileSync('src/renderer/features/debugger/composer/useUserInputRequestSubmit.ts', 'utf8');
const toolApprovalPanelSource = fs.readFileSync('src/renderer/features/debugger/composer/ToolApprovalRequestPanel.tsx', 'utf8');
const toolApprovalSubmitHookSource = fs.readFileSync('src/renderer/features/debugger/composer/useToolApprovalSubmit.ts', 'utf8');
const orchestratorSource = fs.readFileSync('src/main/workflow/debugger/AgentOrchestrator.ts', 'utf8');

assert(presentationSource.includes("block.kind === 'llm_turn'"), 'Work Process sections should be sourced from LLM loop blocks');
assert(presentationSource.includes('WORK_PROCESS_TOOL_DISPLAY_CATALOG'), 'tool display catalog should be canonical');
assert(presentationSource.includes("type: 'toolGroup'"), 'presentation should expose semantic tool groups');
assert(presentationSource.includes("type: 'response'"), 'presentation should expose a final response boundary row');
assert(presentationSource.includes('createResponseRow'), 'presentation should route answer-only loops through response boundaries');
assert(presentationSource.includes('actionCount'), 'presentation should expose actionCount for top-level transcript meta');
assert(presentationSource.includes("normalized.startsWith('mcp__')"), 'dynamic MCP wildcard should have a semantic display path');
assert(!presentationSource.includes("isSummary ? '思考过程'"), 'loop-level summary thinking label must not duplicate the Work Process header');
for (const forbidden of ['Reasoning summary', 'Called tool']) {
  assert(!presentationSource.includes(forbidden), `presentation source should not contain ${forbidden}`);
}

assert(componentSource.includes('ToolGroupRow'), 'component should render semantic tool groups');
assert(componentSource.includes('ResponseRow'), 'component should render the final response boundary row');
assert(componentSource.includes("t('chat.workProcessTitle')"), 'header should use the process title translation');
assert(!componentSource.includes('TRACE_HEADLINE_KEY'), 'top Work Process header must not fall back to status-first copy');
assert(!componentSource.includes('statusMeta'), 'top Work Process meta should be duration/action context, not completion-status copy');
assert(componentSource.includes('work-process-tool-group'), 'group row class should exist in component source');
assert(componentSource.includes('work-process-step-group'), 'semantic step group row class should exist in component source');
assert(componentSource.includes('WorkProcessViewToggle'), 'component should expose grouped/detail view toggle');
assert(componentSource.includes('<details className={thinkingClassName}'), 'thinking should render as a user-collapsible top disclosure');
assert(!componentSource.includes('isSummaryThinking'), 'summary thinking must not bypass the top disclosure hierarchy');
assert(!componentSource.includes("t('chat.workProcessViewSteps'"), 'section should not expose the legacy tool-step disclosure');
assert(!componentSource.includes('StepsListIcon'), 'legacy steps icon component should be removed');
assert(!componentSource.includes('thinking-full'), 'component must not render full hidden CoT mode');

assert(cssSource.includes('.work-process-tool-group'), 'tool group styling should exist');
assert(cssSource.includes('.work-process-step-group'), 'semantic step group styling should exist');
assert(cssSource.includes('.work-process-response'), 'response boundary styling should exist');
assert(cssSource.includes('.work-process-icon'), 'local tool icon styling should exist');
assert(cssSource.includes('.work-process-section-list'), 'section list styling should exist');
assert(cssSource.includes('.work-process-step-rail.status-complete'), 'rail marker color should be status-driven, not section-driven');
assert(cssSource.includes('.work-process-loop-result.is-streaming'), 'result streaming indicator should exist');
assert(cssSource.includes('@media (prefers-reduced-motion: reduce)'), 'streaming motion should honor reduced motion');
assert(cssSource.includes('.work-process-tool-approval'), 'tool approval styling should exist');
assert(cssSource.includes('.work-process-disclosure:not([open]) > :not(summary)'), 'closed disclosure must not render expanded body content');
assert(!cssSource.includes('.work-process-section-steps'), 'legacy tool-step disclosure CSS should be removed');
assert(!cssSource.includes('.work-process-step-rail.is-section .work-process-rail-marker'), 'section markers must not use a hierarchy-only color override');
assert(!cssSource.includes('.work-process-steps-toggle'), 'legacy tool-step toggle CSS should be removed');
assert(!cssSource.includes('.work-process-empty'), 'placeholder empty-state CSS should be removed');

assert(i18nSource.includes("'chat.workProcessTitle': 'Process'"), 'English process title copy should exist');
assert(i18nSource.includes("'chat.workProcessTitle': '思考过程'"), 'Chinese process title copy should exist');
assert(!i18nSource.includes('Tool steps {count}'), 'English legacy tool-step copy should be removed');
assert(!i18nSource.includes('工具步骤'), 'Chinese legacy tool-step copy should be removed');
assert(!i18nSource.includes('Reasoning summary'), 'legacy reasoning label should not exist in i18n');

assert(!userInputPanelSource.includes('window.electronAPI'), 'composer user input panel must not call Electron APIs directly');
assert(userInputSubmitHookSource.includes('answerUserInput'), 'composer user input hook must submit through conversation.answerUserInput');
assert(!toolApprovalPanelSource.includes('window.electronAPI'), 'composer tool approval panel must not call Electron APIs directly');
assert(toolApprovalSubmitHookSource.includes('answerToolApproval'), 'composer tool approval hook must submit through conversation.answerToolApproval');
assert(!orchestratorSource.includes('User input requested by'), 'ask_user tool must not return fake user-request text immediately');

console.log('[work-process] OK');
