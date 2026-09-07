import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { CONTRACT_ROOT, requireRegistered, scriptExists, scriptRead } from './renderer-contract.mjs';

const require = createRequire(import.meta.url);
require('./register-ts-source.cjs');

const {
  buildWorkProcessPresentation,
  normalizeWorkProcessText,
} = require(path.join(CONTRACT_ROOT, requireRegistered('src/renderer/features/transcript/workProcessPresentation.ts')));
const { normalizeAssistantMarkdown } = require(path.join(CONTRACT_ROOT, requireRegistered('src/renderer/patterns/Markdown/normalizeAssistantMarkdown.ts')));

const now = 1_700_000_000_000;

const fail = (message) => {
  console.error(`[work-process] ${message}`);
  process.exit(1);
};

const assert = (condition, message) => {
  if (!condition) fail(message);
};

const readSource = (relativePath) => scriptRead(relativePath);
const activeSignalSource = readSource('src/renderer/ui/ActiveSignalText.tsx');
const activeSignalStyles = readSource('src/renderer/styles/design-system.css');
const activeSignalHelper = readSource('src/renderer/features/transcript/workProcessActiveSignal.ts');
const activeSignalRenderSource = [
  'src/renderer/features/transcript/WorkProcessSectionRow.tsx',
  'src/renderer/features/transcript/ToolAggregateRow.tsx',
  'src/renderer/features/transcript/WorkProcessRows.tsx',
  'src/renderer/features/transcript/SubagentRow.tsx',
  'src/renderer/features/composer/UserInputRequestPanel.tsx',
  'src/renderer/features/composer/ToolApprovalRequestPanel.tsx',
].map(readSource).join('\n');

assert(activeSignalSource.includes('data-active-signal={active ? tone : undefined}'), 'ActiveSignalText should expose an active-state DOM contract');
assert(activeSignalHelper.includes("status === 'running' || status === 'pending'"), 'active signal must be driven by running/pending Work Process status');
assert(activeSignalHelper.includes("thinkingStatus === 'streaming'"), 'active signal must recognize streaming thinking lifecycle');
assert(activeSignalStyles.includes('.active-signal-text.is-active'), 'active signal text CSS class is missing');
assert(activeSignalStyles.includes('background-clip: text'), 'active signal must use clipped-gradient energy shimmer');
assert(activeSignalStyles.includes('background-size: 200% 100%'), 'active signal must tile a 200% energy wash so the loop is one period');
assert(activeSignalStyles.includes('background-repeat: repeat-x'), 'active signal must repeat-x so the loop seam can tile');
assert(
  /@keyframes active-signal-shimmer \{\s*0% \{ background-position: 100% 0; \}\s*100% \{ background-position: -100% 0; \}\s*\}/.test(activeSignalStyles),
  'active signal keyframes must be a continuous 100% to -100% sweep with no hold',
);
assert(!activeSignalStyles.includes('78% { background-position'), 'active signal must not pause mid-cycle');
assert(activeSignalStyles.includes('1.6s linear infinite'), 'active signal must keep the original 1.6s continuous sweep');
assert(activeSignalStyles.includes('color-mix(in srgb, var(--active-signal-highlight) 36%, transparent)'), 'active signal must keep the original 36% wash gradient');
assert(!activeSignalStyles.includes('--active-signal-base'), 'narrow sheen base token must stay removed');
assert(!activeSignalStyles.includes('--active-signal-sheen'), 'narrow sheen highlight token must stay removed');
assert(activeSignalStyles.includes('@keyframes active-signal-shimmer'), 'active signal shimmer keyframe is missing');
assert(!activeSignalStyles.includes('active-signal-pulse'), 'legacy active-signal pulse must be removed');
assert(activeSignalStyles.includes('@media (prefers-reduced-motion: reduce)'), 'active signal must honor reduced-motion preferences');
assert(
  activeSignalStyles.includes("html[data-reduce-motion='on'] .active-signal-text.is-active"),
  'Settings reduceMotion=on must use the static Active Signal highlight fallback',
);
assert(
  !/html\[data-reduce-motion='on'\][\s\S]{0,180}\.active-signal-text\.is-active[\s\S]{0,180}!important/.test(activeSignalStyles),
  'Active Signal reduce-motion fallback must not use !important',
);
assert(activeSignalRenderSource.includes('ActiveSignalText active={active}') || activeSignalRenderSource.includes('ActiveSignalText active '), 'Work Process rows should use shared ActiveSignalText for active labels');
assert(activeSignalRenderSource.includes('tone="interaction"'), 'ask_user interaction surfaces should use the interaction active signal tone');
assert(!activeSignalRenderSource.includes("row.status === 'complete' &&"), 'complete rows must not be a trigger for active signal text');

const flattenRows = (rows) => rows.flatMap((row) => {
  if (row.type === 'section') return [row, ...flattenRows(row.steps)];
  if (row.type === 'toolAggregate') return [row, ...row.children];
  if (row.type === 'toolGroup') return [row, ...flattenRows(row.rows)];
  return [row];
});

const collectVisible = (rows) => rows.flatMap((row) => {
  if (row.type === 'section') return [
    row.proseText,
    row.thinkingLabel,
    row.thinkingSource,
    row.thinkingOpenByDefault ? row.thinkingPreview : '',
    ...collectVisible(row.steps),
  ].filter(Boolean);
  if (row.type === 'toolAggregate') return [
    row.summary,
    ...collectVisible(row.children),
  ].filter(Boolean);
  if (row.type === 'toolGroup') return [
    row.title,
    row.countLabel,
    row.summary,
    ...collectVisible(row.rows),
  ].filter(Boolean);
  if (row.type === 'tool') return [
    row.verb,
    row.toolName,
    row.target,
    row.category,
    row.groupKind,
    row.family,
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
assert(
  normalizeWorkProcessText('item\n  nested\n\tindented') === 'item\n  nested\n\tindented',
  'work-process text should preserve inline indentation',
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
assert(loopSection.proseText === 'Read files before answering.', 'tool-backed commentary should render as narrative prose');
assert(loopSection.thinkingLabel === '', 'commentary must not be promoted into the thinking slot');
assert(loopSection.thinkingPreview === '', 'commentary must not occupy thinking preview');
assert(loopSection.stepCount === 2, `expected 2 tool actions in section, got ${loopSection.stepCount}`);
assert(loopSection.steps.length === 2, `loop section should keep flat tool rows for two tools, got ${loopSection.steps.length}`);
assert(loopSection.steps.every((row) => row.type === 'tool'), 'loop section tools must be flat tool rows without toolGroup shells');
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
assert(rawThinkingSection.thinkingLabel === '已思考 · 0ms', 'raw thinking should use 已思考 · duration settled label');
assert(rawThinkingSection.thinkingPreview === 'provider-visible raw thinking', 'raw provider thinking should remain available behind disclosure');
assert(rawThinkingSection.thinkingOpenByDefault === false, 'settled process-loop raw thinking should fold by policy');

const activeRawThinkingPresentation = buildWorkProcessPresentation({
  status: 'running',
  updatedAt: now + 9810,
  blocks: [
    {
      id: 'runtime-loop-raw-active',
      kind: 'llm_turn',
      title: 'LLM turn',
      status: 'running',
      result: { text: 'Working…', status: 'streaming', toolCallIds: ['think-glob-active'] },
      thinking: {
        text: 'provider-visible raw thinking while live',
        kind: 'raw',
        source: 'openai-compatible-raw',
        visibility: 'raw-collapsed',
      },
      thinkingStatus: 'streaming',
      toolCalls: [{ id: 'think-glob-active', toolName: 'glob', status: 'running', argsPreview: JSON.stringify({ pattern: 'src/**/*.ts' }), startedAt: now + 200 }],
      startedAt: now + 200,
    },
  ],
});
const activeRawThinkingSection = activeRawThinkingPresentation.rows.find((row) => row.type === 'section');
assert(activeRawThinkingSection?.type === 'section', 'active raw thinking loop should render a section');
assert(activeRawThinkingSection.thinkingLabel === '正在思考', 'active raw thinking should use streaming label');
assert(activeRawThinkingSection.thinkingOpenByDefault === true, 'active process-loop raw thinking should expand by policy');

const activeSummaryThinkingPresentation = buildWorkProcessPresentation({
  status: 'running',
  updatedAt: now + 9820,
  blocks: [
    {
      id: 'runtime-loop-summary-active',
      kind: 'llm_turn',
      title: 'LLM turn',
      status: 'running',
      result: { text: 'Working…', status: 'streaming', toolCallIds: ['think-read-active'] },
      thinking: {
        text: 'planning the next tool call',
        kind: 'summary',
        source: 'anthropic-thinking',
        visibility: 'summary',
      },
      thinkingStatus: 'streaming',
      toolCalls: [{ id: 'think-read-active', toolName: 'read_file', status: 'running', argsPreview: JSON.stringify({ path: 'README.md' }), startedAt: now + 210 }],
      startedAt: now + 210,
    },
  ],
});
const activeSummaryThinkingSection = activeSummaryThinkingPresentation.rows.find((row) => row.type === 'section');
assert(activeSummaryThinkingSection?.type === 'section', 'active summary thinking loop should render a section');
assert(activeSummaryThinkingSection.thinkingOpenByDefault === true, 'active process-loop summary thinking should expand by policy');

const summaryThinkingPresentation = buildWorkProcessPresentation({
  status: 'complete',
  updatedAt: now + 9900,
  blocks: [
    {
      id: 'runtime-loop-summary',
      kind: 'llm_turn',
      title: 'LLM turn',
      status: 'complete',
      result: { text: 'Turn result.', status: 'complete', toolCallIds: [], stopReason: 'end_turn', outputPhase: 'final_answer' },
      thinking: {
        text: 'The user asks in Chinese. Now answer in Chinese.',
        kind: 'summary',
        source: 'anthropic-thinking',
        visibility: 'summary',

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
assert(summaryThinkingSection.proseText === '', 'answer-only thinking must not duplicate final answer text');
assert(summaryThinkingSection.thinkingLabel === '已思考 · 5ms', 'summary thinking should use 已思考 · duration settled label');
assert(summaryThinkingSection.thinkingOpenByDefault === false, 'final-answer quiet thinking stays folded by default');

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
assert(!duplicateSummaryPresentation.rows.some((row) => row.type === 'response'), 'answer-only loops must not create Reply response boundary rows');
assert(!JSON.stringify(duplicateSummaryPresentation.rows).includes('Final answer body only.'), 'Work Process must not duplicate final answer body text');

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

      },
      thinkingStatus: 'streaming',
      toolCalls: [],
      startedAt: now + 380,
    },
  ],
});
assert(streamingResponsePresentation.rows.map((row) => row.type).join(',') === 'section,section', 'final answer streaming should render process section plus quiet thinking-only section');
assert(!streamingResponsePresentation.rows.some((row) => row.type === 'response'), 'final answer streaming must not create a Reply boundary row');
const closingThinking = streamingResponsePresentation.rows.filter((row) => row.type === 'section').at(-1);
assert(closingThinking?.thinkingOpenByDefault === true, 'active closing thinking should expand by policy while streaming');
assert(closingThinking?.thinkingPreview === 'Now produce the final answer.', 'closing summary should fold into a thinking-only section');
assert(!JSON.stringify(closingThinking).includes('Streaming final answer tokens.'), 'streaming final answer text should stay out of Work Process');

const settledClosingThinkingPresentation = buildWorkProcessPresentation({
  status: 'complete',
  updatedAt: now + 9968,
  blocks: [
    {
      id: 'runtime-loop-response-before-tools-settled',
      kind: 'llm_turn',
      title: 'LLM turn',
      status: 'complete',
      result: { text: 'Read memory before answer.', status: 'complete', toolCallIds: ['response-tool-memory-settled'] },
      thinking: {
        text: 'Read project memory before answering settled.',
        kind: 'summary',
        source: 'anthropic-thinking',
        visibility: 'summary',
      },
      thinkingStatus: 'complete',
      toolCalls: [
        { id: 'response-tool-memory-settled', toolName: 'memory_read', status: 'complete', argsPreview: JSON.stringify({ key: 'project-identity' }), startedAt: now + 370, completedAt: now + 375 },
      ],
      startedAt: now + 370,
      completedAt: now + 375,
    },
    {
      id: 'runtime-loop-response-final-settled',
      kind: 'llm_turn',
      title: 'LLM turn',
      status: 'complete',
      result: {
        text: 'Final answer body.',
        status: 'complete',
        toolCallIds: [],
        stopReason: 'end_turn',
        outputPhase: 'final_answer',
      },
      thinking: {
        text: 'Now produce the final answer settled.',
        kind: 'summary',
        source: 'anthropic-thinking',
        visibility: 'summary',
      },
      thinkingStatus: 'complete',
      toolCalls: [],
      startedAt: now + 380,
      completedAt: now + 390,
    },
  ],
});
const settledClosingThinking = settledClosingThinkingPresentation.rows.filter((row) => row.type === 'section').at(-1);
assert(settledClosingThinking?.thinkingOpenByDefault === false, 'settled closing thinking should fold by policy');
assert(settledClosingThinking?.thinkingPreview === 'Now produce the final answer settled.', 'settled closing thinking keeps preview behind disclosure');

const activeFinalAnswerThinkingPresentation = buildWorkProcessPresentation({
  status: 'running',
  updatedAt: now + 9970,
  blocks: [
    {
      id: 'runtime-loop-final-active',
      kind: 'llm_turn',
      title: 'LLM turn',
      status: 'running',
      result: {
        text: '',
        status: 'streaming',
        toolCallIds: [],
        stopReason: 'end_turn',
        outputPhase: 'final_answer',
      },
      thinking: {
        text: 'compose the final answer while streaming',
        kind: 'raw',
        source: 'openai-compatible-raw',
        visibility: 'raw-collapsed',
      },
      thinkingStatus: 'streaming',
      toolCalls: [],
      startedAt: now + 400,
    },
  ],
});
const activeFinalAnswerThinkingSection = activeFinalAnswerThinkingPresentation.rows.find((row) => row.type === 'section');
assert(activeFinalAnswerThinkingSection?.type === 'section', 'active final-answer thinking should render a section');
assert(activeFinalAnswerThinkingSection.thinkingOpenByDefault === true, 'active final-answer thinking should expand by policy');
assert(activeFinalAnswerThinkingSection.thinkingLabel === '正在思考', 'active final-answer thinking should use streaming label');

const opaquePresentation = buildWorkProcessPresentation({
  status: 'complete',
  updatedAt: now + 9970,
  blocks: [
    {
      id: 'runtime-loop-opaque',
      kind: 'llm_turn',
      title: 'LLM turn',
      status: 'complete',
      result: {
        text: 'Provider state retained.',
        status: 'complete',
        toolCallIds: [],
        stopReason: 'end_turn',
        outputPhase: 'final_answer',
      },
      thinking: {
        kind: 'opaque',
        source: 'openai-responses-encrypted',
        visibility: 'hidden',


      },
      thinkingStatus: 'complete',
      toolCalls: [],
      startedAt: now + 350,
      completedAt: now + 360,
    },
  ],
});
assert(opaquePresentation.rows.length === 0, 'opaque final_answer without visible evidence must stay answer-body-only');
assert(!opaquePresentation.rows.some((row) => row.type === 'section'), 'opaque provider state should not render a section row');
assert(!opaquePresentation.rows.some((row) => row.type === 'reasoningIndicator'), 'opaque/hidden must never render a CoT placeholder indicator');

const opaqueToolPresentation = buildWorkProcessPresentation({
  status: 'complete',
  updatedAt: now + 9980,
  blocks: [
    {
      id: 'runtime-loop-opaque-tool',
      kind: 'llm_turn',
      title: 'LLM turn',
      status: 'complete',
      result: {
        status: 'complete',
        toolCallIds: ['tool-opaque-search'],
        stopReason: 'tool_use',
        outputPhase: 'commentary',
      },
      thinking: {
        kind: 'opaque',
        source: 'openai-responses-encrypted',
        visibility: 'hidden',
      },
      thinkingStatus: 'complete',
      toolCalls: [
        {
          id: 'tool-opaque-search',
          toolName: 'web_search',
          status: 'complete',
          argsPreview: JSON.stringify({ query: 'GPU news' }),
          resultPreview: JSON.stringify({ ok: true, data: { results: [{ url: 'https://example.com' }] } }),
          startedAt: now + 370,
          completedAt: now + 390,
        },
      ],
      startedAt: now + 360,
      completedAt: now + 390,
    },
  ],
});
const opaqueToolRows = flattenRows(opaqueToolPresentation.rows);
assert(opaqueToolRows.some((row) => row.type === 'tool' && row.toolName === 'web_search'), 'opaque + tools must still surface real tool evidence');
assert(!opaqueToolRows.some((row) => row.type === 'reasoningIndicator'), 'opaque + tools must not insert a CoT placeholder');

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
          argsPreview: '2 questions',
          userInputQuestions: [{
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
          startedAt: now + 3000,
        },
      ],
      startedAt: now + 3000,
    },
  ],
});
const askUserRows = flattenRows(askUserPresentation.rows);
const askUserRow = askUserRows.find((row) => row.type === 'userInput');
assert(askUserRow?.verb === '正在询问', 'pending ask_user should render asking verb');
assert(askUserRow?.questionCount === 2, `batch ask_user should count real questions, got ${askUserRow?.questionCount}`);
assert(askUserRow.items.length === 2, 'ask_user should expose each batch question as a transcript item');
assert(askUserRow.items[0].prompt.includes('Which smoke path'), 'ask_user first question should be visible');
assert(!askUserRows.some((row) => row.type === 'toolGroup'), 'ask_user must not wrap in a toolGroup shell');

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
assert(Array.isArray(webSearchRow.sourcePills) && webSearchRow.sourcePills.length > 0, 'web_search should expose source pills');
assert(webSearchRow.sourcePills.some((pill) => pill.domain === 'renderdoc.org'), 'web_search source pill should include result domain');
assert(webSearchRow.sourcePills.every((pill) => pill.domain), 'web_search source pills must carry domain labels');
assert(!webSearchRow.pageChip, 'web_search must not use web_fetch pageChip');

const webFetchPresentation = buildWorkProcessPresentation({
  status: 'complete',
  updatedAt: now + 9200,
  blocks: [
    {
      id: 'runtime-loop-web-fetch',
      kind: 'llm_turn',
      title: 'LLM turn',
      status: 'complete',
      result: { text: 'Fetch the page.', status: 'complete', toolCallIds: ['tool-web-fetch'] },
      toolCalls: [
        {
          id: 'tool-web-fetch',
          toolName: 'web_fetch',
          status: 'complete',
          argsPreview: JSON.stringify({ url: 'https://www.example.com/docs/guide' }),
          resultPreview: JSON.stringify({
            ok: true,
            data: {
              content: [{ type: 'text', text: 'URL: https://www.example.com/docs/guide\nTitle: Example Guide\nStatus: 200 OK' }],
              details: {
                kind: 'fetch',
                url: 'https://www.example.com/docs/guide',
                status: 200,
                statusText: 'OK',
                bytes: 2048,
                truncated: false,
                title: 'Example Guide',
              },
            },
          }),
          startedAt: now + 8000,
          completedAt: now + 8050,
        },
      ],
      startedAt: now + 8000,
      completedAt: now + 8050,
    },
  ],
});
const webFetchRow = flattenRows(webFetchPresentation.rows).find((row) => row.type === 'tool' && row.toolName === 'web_fetch');
assert(webFetchRow?.verb === '已抓取', 'web_fetch should use Fetched page/已抓取 verb');
assert(webFetchRow?.icon === 'webFetch', 'web_fetch should use dedicated webFetch icon');
assert(webFetchRow?.pageChip?.domain === 'www.example.com', 'web_fetch should expose pageChip domain');
assert(webFetchRow?.pageChip?.url === 'https://www.example.com/docs/guide', 'web_fetch pageChip should keep url');
assert(webFetchRow?.pageChip?.pathLabel === '/docs/guide', 'web_fetch pageChip should expose pathLabel');
assert(webFetchRow?.pageChip?.status === 200, 'web_fetch pageChip should expose status');
assert(webFetchRow?.pageChip?.bytes === 2048, 'web_fetch pageChip should expose bytes');
assert(webFetchRow?.pageChip?.title === 'Example Guide', 'web_fetch pageChip should expose title');
assert(!webFetchRow?.sourcePills?.length, 'web_fetch must not reuse search source pills');
assert(webFetchRow?.icon !== webSearchRow?.icon, 'web_fetch and web_search icons must differ');

const shellEnvelopePresentation = buildWorkProcessPresentation({
  status: 'complete',
  updatedAt: now + 9300,
  blocks: [
    {
      id: 'runtime-loop-shell-envelope',
      kind: 'llm_turn',
      title: 'LLM turn',
      status: 'complete',
      result: { text: 'Ran typecheck.', status: 'complete', toolCallIds: ['tool-shell-envelope'] },
      toolCalls: [
        {
          id: 'tool-shell-envelope',
          toolName: 'shell',
          status: 'complete',
          argsPreview: JSON.stringify({ command: 'pnpm run typecheck' }),
          resultPreview: JSON.stringify({
            ok: true,
            data: {
              content: [{ type: 'text', text: 'Found 0 errors.' }],
              details: { command: 'pnpm run typecheck', exitCode: 0 },
            },
            duration_ms: 90,
            trace_id: 'tool-shell-envelope',
          }),
          startedAt: now + 8000,
          completedAt: now + 8090,
        },
      ],
      startedAt: now + 8000,
      completedAt: now + 8090,
    },
  ],
});
const shellEnvelopeRow = flattenRows(shellEnvelopePresentation.rows).find((row) => row.type === 'tool' && row.toolName === 'shell');
assert(shellEnvelopeRow?.previewKind === 'shell', 'shell should project shell preview kind');
assert(shellEnvelopeRow?.commandText === 'pnpm run typecheck', 'shell should expose commandText for the terminal header');
assert(shellEnvelopeRow.previewLines.some((line) => line.includes('Found 0 errors.')), 'shell preview should keep stdout content layer');
assert(!shellEnvelopeRow.previewLines.join('\n').includes('trace_id'), 'shell preview must not include envelope trace_id');
assert(!shellEnvelopeRow.previewLines.join('\n').includes('duration_ms'), 'shell preview must not include envelope duration_ms');
assert(shellEnvelopeRow.rawLines.join('\n').includes('trace_id'), 'shell raw tier should keep the full envelope');

const skillEnvelopePresentation = buildWorkProcessPresentation({
  status: 'complete',
  updatedAt: now + 9400,
  blocks: [
    {
      id: 'runtime-loop-skill-envelope',
      kind: 'llm_turn',
      title: 'LLM turn',
      status: 'complete',
      result: { text: 'Loaded skill.', status: 'complete', toolCallIds: ['tool-skill-envelope'] },
      toolCalls: [
        {
          id: 'tool-skill-envelope',
          toolName: 'skill_read',
          status: 'complete',
          argsPreview: JSON.stringify({ skill_id: 'arming-thought' }),
          resultPreview: JSON.stringify({
            ok: true,
            data: {
              content: [{ type: 'text', text: '# Title\n\nFull skill markdown body that must stay in raw only.\n\n## Extra\n\nmore' }],
              details: {
                skillId: 'arming-thought',
                description: 'Establish qiushi principles at conversation start.',
                sourcePath: '/skills/arming-thought/SKILL.md',
              },
            },
            duration_ms: 12,
            trace_id: 'tool-skill-envelope',
          }),
          startedAt: now + 8100,
          completedAt: now + 8112,
        },
      ],
      startedAt: now + 8100,
      completedAt: now + 8112,
    },
  ],
});
const skillEnvelopeRow = flattenRows(skillEnvelopePresentation.rows).find((row) => row.type === 'tool' && row.toolName === 'skill_read');
assert(skillEnvelopeRow?.previewKind === 'skill', 'skill_read should project skill preview kind');
assert(skillEnvelopeRow?.pathChip === '/skills/arming-thought/SKILL.md', 'skill_read should expose path chip');
assert(skillEnvelopeRow.previewLines.length === 1, 'skill preview should be a single description line');
assert(skillEnvelopeRow.previewLines[0].includes('Establish qiushi'), 'skill preview should use the short description');
assert(!skillEnvelopeRow.previewLines.join('\n').includes('Full skill markdown'), 'skill preview must not dump full markdown');
assert(skillEnvelopeRow.rawLines.join('\n').includes('Full skill markdown'), 'skill raw tier should keep full markdown');

const fileGutterPresentation = buildWorkProcessPresentation({
  status: 'complete',
  updatedAt: now + 9500,
  blocks: [
    {
      id: 'runtime-loop-file-gutter',
      kind: 'llm_turn',
      title: 'LLM turn',
      status: 'complete',
      result: { text: 'Read project yaml.', status: 'complete', toolCallIds: ['tool-read-gutter'] },
      toolCalls: [
        {
          id: 'tool-read-gutter',
          toolName: 'read_file',
          status: 'complete',
          argsPreview: JSON.stringify({ path: '.rdx/project.yaml' }),
          resultPreview: JSON.stringify({
            ok: true,
            data: {
              content: [{ type: 'text', text: '1→schema_version: "1"\n2→name: "rdc"\n3→' }],
            },
          }),
          startedAt: now + 8200,
          completedAt: now + 8210,
        },
      ],
      startedAt: now + 8200,
      completedAt: now + 8210,
    },
  ],
});
const fileGutterRow = flattenRows(fileGutterPresentation.rows).find((row) => row.type === 'tool' && row.toolName === 'read_file');
assert(fileGutterRow?.previewKind === 'file', 'read_file should project file preview kind');
assert(fileGutterRow?.pathChip === '.rdx/project.yaml', 'read_file should expose pathChip');
assert(!fileGutterRow.previewLines.join('\n').includes('→'), 'file preview must strip Unicode line-number gutters');
assert(fileGutterRow.previewLines.some((line) => line.includes('schema_version')), 'file preview should keep content after gutter strip');

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
const mcpRow = mcpRows.find((row) => row.type === 'tool');
assert(!mcpRows.some((row) => row.type === 'toolGroup'), 'dynamic MCP tools must stay flat without toolGroup shells');
assert(mcpRow?.target === 'filesystem/read_file', 'dynamic MCP target should show server/tool');
assert(mcpRow?.category === 'MCP' || mcpRow?.groupKind === 'mcp', 'dynamic MCP tools should keep MCP semantics');

const componentSource = [
  scriptRead('src/renderer/features/transcript/WorkProcess.tsx', 'utf8'),
  scriptRead('src/renderer/features/transcript/WorkProcessSectionRow.tsx', 'utf8'),
  scriptRead('src/renderer/features/transcript/ToolAggregateRow.tsx', 'utf8'),
  scriptRead('src/renderer/features/transcript/workProcessRowRenderer.tsx', 'utf8'),
  scriptRead('src/renderer/features/transcript/WorkProcessRows.tsx', 'utf8'),
  scriptRead('src/renderer/features/transcript/WorkProcessRowParts.tsx', 'utf8'),
  scriptRead('src/renderer/features/transcript/WorkProcessToolCardParts.tsx', 'utf8'),
  scriptRead('src/renderer/features/transcript/WorkProcessFamilyLayers.tsx', 'utf8'),
  scriptRead('src/renderer/features/transcript/WorkProcessHighlightedCode.tsx', 'utf8'),
  scriptRead('src/renderer/features/transcript/WorkProcessIcons.tsx', 'utf8'),
].join('\n');
const cssSource = [
  scriptRead('src/renderer/features/transcript/AgentChat.css', 'utf8'),
  scriptRead('src/renderer/features/transcript/AgentChat.extras.css', 'utf8'),
].join('\n');
const composerDir = path.join(CONTRACT_ROOT, 'src/renderer/features/composer');
const appShellSource = [
  scriptRead('src/renderer/features/composer/composer-chrome.css', 'utf8'),
  ...fs.readdirSync(composerDir)
    .filter((name) => /^composer-chrome-\d+\.css$/.test(name))
    .sort()
    .map((name) => fs.readFileSync(path.join(composerDir, name), 'utf8')),
].join('\n');
const presentationSource = [
  scriptRead('src/renderer/features/transcript/workProcessPresentation.ts', 'utf8'),
  scriptRead('src/renderer/features/transcript/workProcessBlockProjection.ts', 'utf8'),
  scriptRead('src/renderer/features/transcript/workProcessToolAggregate.ts', 'utf8'),
  scriptRead('src/renderer/features/transcript/workProcessToolCatalog.ts', 'utf8'),
].join('\n');
const i18nSource = [
  scriptRead('src/renderer/i18n.ts', 'utf8'),
  ...fs.readdirSync(path.join(CONTRACT_ROOT, 'src/renderer/i18n/locales'), { recursive: true })
    .filter((entry) => String(entry).endsWith('.ts'))
    .map((entry) => fs.readFileSync(path.join(CONTRACT_ROOT, 'src/renderer/i18n/locales', entry), 'utf8')),
].join('\n');
const userInputPanelSource = scriptRead('src/renderer/features/composer/UserInputRequestPanel.tsx', 'utf8');
const userInputSubmitHookSource = scriptRead('src/renderer/features/composer/useUserInputRequestSubmit.ts', 'utf8');
const toolApprovalPanelSource = scriptRead('src/renderer/features/composer/ToolApprovalRequestPanel.tsx', 'utf8');
const toolApprovalSubmitHookSource = scriptRead('src/renderer/features/composer/useToolApprovalSubmit.ts', 'utf8');
const orchestratorSource = scriptRead('src/main/workflow/debugger/AgentOrchestrator.ts', 'utf8');

assert(presentationSource.includes('resolveSectionProse'), 'commentary should route through resolveSectionProse');
assert(
  /outputPhase\s*===\s*'commentary'/.test(presentationSource)
    && !presentationSource.includes('void outputPhase'),
  'settled commentary prose must follow outputPhase, not void it',
);
assert(
  !/canShow\s*=\s*[\s\S]*toolCalls\.length\s*>\s*0/.test(presentationSource),
  'commentary visibility must not require toolCalls on the same loop',
);
assert(
  /canShow\s*=\s*isMeaningfulText\(commentary\)\s*&&\s*outputPhase\s*===\s*'commentary'/.test(presentationSource),
  'only explicitly classified commentary may enter Work Process prose',
);
assert(
  (() => {
    const source = readSource('src/main/conversation/ConversationTurnAgentEventHandler.ts');
    return source.includes('turnHadAskPause')
      && source.includes('resolveStreamingOutputPhase')
      && source.includes('syncVisibleResponseForStreaming')
      && source.includes("outputPhase === 'commentary'")
      && source.includes("stopReason === 'tool_use'")
      && /pendingNewLoop\s*=\s*true/.test(source);
  })(),
  'ask/commentary pauses must set pendingNewLoop, stamp streaming outputPhase, and avoid CoT final flash',
);
assert(
  /\.work-process-user-input-transcript\s*\{[^}]*gap:\s*var\(--space-4\)/.test(cssSource),
  'Asked transcript items should use space-3 gap between numbered Q/A pairs',
);
assert(
  componentSource.includes('work-process-user-input-transcript-index')
    && /\.work-process-user-input-transcript-item\s*\{[^}]*grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)/.test(cssSource)
    && !componentSource.includes('work-process-user-input-options')
    && !componentSource.includes('work-process-user-input-transcript-description'),
  'Asked transcript should number questions in a grid and indent answers under the prompt',
);
assert(
  /\.work-process-user-input\s*\{[^}]*border:\s*1px\s+solid\s+var\(--token-border-muted\)/.test(cssSource),
  'Asked rows should use the same card border chrome as tool cards',
);
assert(presentationSource.includes('proseText'), 'presentation should expose narrative prose on sections');
assert(presentationSource.includes('aggregateSectionSteps'), 'presentation should aggregate consecutive tools');
assert(presentationSource.includes("type: 'toolAggregate'"), 'presentation should expose toolAggregate rows');
assert(presentationSource.includes('buildToolAggregateSummary'), 'tool aggregate summaries should be built centrally');
assert(!presentationSource.includes('buildSemanticStepGroups'), 'semantic step grouping must be removed');
assert(presentationSource.includes("block.kind === 'llm_turn'"), 'Work Process sections should be sourced from LLM loop blocks');
assert(presentationSource.includes('WORK_PROCESS_TOOL_DISPLAY_CATALOG'), 'tool display catalog should be canonical');
assert(!presentationSource.includes("type: 'toolGroup'"), 'presentation must not expose toolGroup shells');
assert(!presentationSource.includes("type: 'response'"), 'presentation must not expose a Reply response boundary row');
assert(!presentationSource.includes('createResponseRow'), 'answer-only loops must not route through createResponseRow');
assert(!presentationSource.includes('createReasoningIndicatorRow'), 'opaque/hidden must not project CoT placeholder rows');
assert(!presentationSource.includes("type: 'reasoningIndicator'"), 'presentation must not expose reasoningIndicator rows');
assert(!componentSource.includes('WorkProcessReasoningIndicatorRow'), 'component must not render CoT placeholder indicator');
assert(!componentSource.includes('work-process-reasoning-indicator'), 'component must not mount CoT placeholder DOM');
assert(!i18nSource.includes('workProcessInternalReasoning'), 'i18n must not keep opaque CoT placeholder copy');
assert(!cssSource.includes('.work-process-reasoning-indicator'), 'CSS must not keep CoT placeholder styles');
assert(presentationSource.includes('getToolFamily'), 'tool projection should map tools onto unified card families');
assert(presentationSource.includes('actionCount'), 'presentation should expose actionCount for top-level transcript meta');
assert(!componentSource.includes('chat.workProcessToolEvidence'), 'Work Process must not render a redundant succeeded/failed/skipped aggregate');
assert(!i18nSource.includes('chat.workProcessToolEvidence'), 'redundant Work Process tool aggregate copy must be removed');
assert(presentationSource.includes("normalized.startsWith('mcp__')"), 'dynamic MCP wildcard should have a semantic display path');
assert(presentationSource.includes("label: status === 'streaming' || isActiveBlock"), 'thinking labels should branch on active vs settled state');
assert(presentationSource.includes('resolveSettledThinkingLabel'), 'settled thinking should resolve Thought-for labels centrally');
assert(presentationSource.includes('已思考 ·'), 'settled thinking label should use 已思考 · duration copy');
assert(!presentationSource.includes('`思考了 ${duration}`') && !presentationSource.includes('思考了 ${duration}'), 'settled thinking must not use 思考了 duration copy');
assert(!presentationSource.includes('深度思考'), 'depth-thinking copy must not appear in presentation');
assert(componentSource.includes('work-process-thinking-icon'), 'thinking folds should show a quiet leading icon');
assert(componentSource.includes('work-process-tool-card'), 'tools should render as a unified tool card');
assert(componentSource.includes('work-process-tool-card-raw'), 'tool cards should expose a styled Raw panel');
assert(cssSource.includes('.work-process-tool-card'), 'tool card styling should exist');
assert(cssSource.includes('.work-process-tool-card-raw'), 'tool card raw panel styling should exist');
assert(cssSource.includes('.work-process-thinking-icon'), 'thinking icon styling should exist');
assert(!presentationSource.includes(": '思考过程'"), 'settled thinking must not reuse the Work process header title 思考过程');
assert(!presentationSource.includes("'原始思考'"), 'product copy must not use 原始思考');
assert(!presentationSource.includes("isSummary ? '思考'"), 'settled thinking must not split summary/raw labels');
for (const forbidden of ['Called tool']) {
  assert(!presentationSource.includes(forbidden), `presentation source should not contain ${forbidden}`);
}

assert(!componentSource.includes('ToolGroupRow'), 'component must not render toolGroup shells');
assert(componentSource.includes('ToolAggregateRow'), 'component should render tool aggregate rows');
assert(componentSource.includes('work-process-narrative-stream'), 'component should use narrative stream list class');
assert(componentSource.includes('work-process-prose'), 'component should render narrative prose');
assert(!componentSource.includes('ResponseRow'), 'component must not render a Reply response boundary row');
assert(!scriptExists('src/renderer/features/transcript/WorkProcessResponseRow.tsx'), 'WorkProcessResponseRow must be deleted');
assert(componentSource.includes("t('chat.workProcessTitle')"), 'header should use the process title translation');
assert(componentSource.includes("t('chat.workProcessHeadlineRunning')"), 'running header should use Working copy');
assert(componentSource.includes('ActiveSignalText'), 'running header should use ActiveSignalText');
assert(!componentSource.includes('TRACE_HEADLINE_KEY'), 'top Work Process header must not fall back to status-first copy');
assert(!componentSource.includes('statusMeta'), 'top Work Process meta should be duration/action context, not completion-status copy');
assert(!componentSource.includes('work-process-tool-group'), 'tool group class must be removed from component source');
assert(!componentSource.includes('work-process-step-group'), 'semantic step group row class must be removed');
assert(!componentSource.includes('WorkProcessViewToggle'), 'grouped/detail view toggle must be removed');
assert(!componentSource.includes('buildSemanticStepGroups'), 'semantic grouping must not remain in components');
for (const removedPath of [
  'src/renderer/features/transcript/workProcessGrouping.ts',
  'src/renderer/features/transcript/WorkProcessStepGroupRow.tsx',
  'src/renderer/features/transcript/WorkProcessViewToggle.tsx',
  'src/renderer/features/transcript/workProcessGroupMetrics.ts',
  'src/renderer/features/transcript/workProcessSemanticIcons.ts',
  'src/renderer/features/transcript/workProcessSemanticKind.ts',
]) {
  assert(!scriptExists(removedPath), `legacy path must be deleted: ${removedPath}`);
}
assert(scriptExists('src/renderer/features/transcript/workProcessToolAggregate.ts'), 'tool aggregate helper must exist');
assert(scriptExists('src/renderer/features/transcript/ToolAggregateRow.tsx'), 'ToolAggregateRow must exist');
assert(scriptExists('src/renderer/features/transcript/workProcessUnits.ts'), 'presentation units helper must exist');
assert(componentSource.includes('work-process-tool-diagnostic'), 'failed tools should expose a diagnostic caption exit');
assert(componentSource.includes('diagnosticCaption'), 'tool rows should carry diagnosticCaption from projection');
const toolRowSource = [
  scriptRead('src/renderer/features/transcript/WorkProcessRowParts.tsx', 'utf8'),
  scriptRead('src/renderer/features/transcript/WorkProcessToolCardParts.tsx', 'utf8'),
].join('\n');
assert(toolRowSource.includes('useState(false)'), 'tool cards must start collapsed by default');
assert(!toolRowSource.includes("row.status === 'running' && canExpand"), 'running tools must not auto-expand detail/Raw');
assert(!toolRowSource.includes('setExpanded(true)'), 'tool cards must not programmatically auto-expand');
assert(!toolRowSource.includes('useEffect'), 'tool cards must not use effects to force-expand on status');
assert(toolRowSource.includes('row.bodyText'), 'tool cards must prefer outcome-first bodyText');
assert(toolRowSource.includes('bodyLines'), 'search cards may render collapsed bodyLines samples');
assert(toolRowSource.includes('work-process-tool-card-body-list'), 'collapsed search samples should use a body list');
assert(presentationSource.includes('bodyText:'), 'projection must emit bodyText for outcome-first cards');
assert(scriptExists('src/shared/utils/toolResultPreview.ts'), 'tool result preview builder must exist');
assert(
  readSource('src/main/conversation/ConversationTurnAgentEventHandler.ts').includes('buildToolResultPreview'),
  'Conversation turn handler must write projection-friendly resultPreview',
);
assert(
  !readSource('src/main/conversation/ConversationTurnAgentEventHandler.ts').includes('.slice(0, 800)'),
  'Conversation turn handler must not blind-slice resultPreview JSON at 800 chars',
);
const conversationEventHandlerSource = readSource('src/main/conversation/ConversationTurnAgentEventHandler.ts');
const diagnosticPolicySource = readSource('src/main/conversation/workProcessDiagnosticPolicy.ts');
assert(
  conversationEventHandlerSource.includes('shouldProjectDiagnosticToWorkProcess'),
  'Conversation turn handler must gate Work Process diagnostic projection',
);
assert(
  diagnosticPolicySource.includes("code.startsWith('error_recovery_')")
    && diagnosticPolicySource.includes('return false'),
  'error_recovery_* must be excluded from Work Process narrative',
);
assert(
  !conversationEventHandlerSource.includes("title: isRecovery ? '错误恢复'"),
  'recovery diagnostics must not receive a Work Process title in the event handler',
);
assert(
  !conversationEventHandlerSource.includes('错误恢复成功，继续生成回复'),
  'recovery completion copy must not be hard-coded into the Work Process event handler',
);
assert(!componentSource.includes('setRawOpen(true);\n      setPreviewOpen(true);'), 'failed tools must not force-open preview and raw together on error');
assert(componentSource.includes('<details'), 'thinking should render as a user-collapsible top disclosure');
assert(componentSource.includes('handleThinkingSummaryClick'), 'thinking disclosure must accept user summary-click gestures');
assert(componentSource.includes('thinkingUserOverridden'), 'thinking disclosure must sticky-override policy after user gesture');
assert(!componentSource.includes('open={row.thinkingOpenByDefault}'), 'thinking disclosure must not bind open solely to policy without local state');
assert(!componentSource.includes('onToggle={handleThinkingToggle}'), 'thinking must not use details onToggle for sticky override (programmatic open fires toggle)');
assert(!componentSource.includes('isSummaryThinking'), 'summary thinking must not bypass the top disclosure hierarchy');
assert(
  presentationSource.includes('openByDefault: isActiveBlock || status === \'streaming\'')
    || presentationSource.includes('openByDefault: isActiveBlock || status === "streaming"'),
  'process-loop thinking policy must expand while active/streaming',
);
assert(!componentSource.includes("t('chat.workProcessViewSteps'"), 'section should not expose the legacy tool-step disclosure');
assert(!componentSource.includes('StepsListIcon'), 'legacy steps icon component should be removed');
assert(!componentSource.includes('thinking-full'), 'component must not render full hidden CoT mode');
assert(!componentSource.includes('RequestInspector'), 'Request Inspector must not embed in Work Process transcript');
const traceRightPanelSource = readSource('src/renderer/features/right-rail/TraceRightPanel.tsx');
assert(
  !scriptExists('src/renderer/features/right-rail/SessionControlPanel.tsx'),
  'Retired session right panel must not return.',
);
assert(
  !traceRightPanelSource.includes('RequestInspector')
    && !traceRightPanelSource.includes('TraceRequestInspectorSection'),
  'Request Inspector must not mount in the default right rail.',
);
assert(
  !scriptExists('src/renderer/features/debugger/RequestDiagnostics'),
  'RequestDiagnostics frontend must remain removed until a dedicated Debug View ships',
);
assert(
  !scriptExists('src/renderer/features/settings/SettingsModal/sections/DeveloperDiagnosticsSettings.tsx'),
  'Settings Diagnostics page must remain removed',
);
assert(
  !readSource('src/renderer/features/settings/SettingsModal/types.ts').includes("'diagnostics'"),
  'SettingsSection must not restore diagnostics',
);
assert(
  readSource('src/renderer/features/settings/SettingsModal/types.ts').includes("'policy'"),
  'SettingsSection must include peer policy navigation',
);
assert(
  readSource('src/renderer/features/settings/SettingsModal/useSettingsModal.ts').includes("id: 'policy'")
    && !readSource('src/renderer/features/settings/SettingsModal/useSettingsModal.ts').includes("id: 'diagnostics'"),
  'Settings nav must list Policy and must not list Diagnostics',
);
assert(
  !traceRightPanelSource.includes('RdxRuntimeContextPanel'),
  'Right rail must consume the unified RDX Context projection.',
);

assert(!componentSource.includes('work-process-tool-target is-toggle'), 'tool target dual-toggle disclosure must be removed');
assert(!componentSource.includes('work-process-tool-verb is-toggle'), 'tool verb dual-toggle disclosure must be removed');
assert(componentSource.includes('work-process-tool-card-header'), 'tool cards should use a single clickable header disclosure');
assert(componentSource.includes("aria-label={t('chat.workProcessRawData')}"), 'Raw data copy should remain as aria-label only');
assert(!componentSource.includes('work-process-debug-toggle'), 'nested Raw data toggle button must be removed');
assert(!componentSource.includes('work-process-debug-disclosure'), 'nested raw details disclosure must be removed');
assert(!componentSource.includes('work-process-preview-disclosure'), 'nested Console output disclosure must be removed');
assert(!componentSource.includes('work-process-preview-toggle'), 'nested Console output toggle must be removed');

assert(!cssSource.includes('.work-process-tool-group'), 'tool group styling must be removed');
assert(!cssSource.includes('.work-process-step-group'), 'semantic step group styling must be removed');
assert(cssSource.includes('.work-process-source-pills') || cssSource.includes('.work-process-source-pill'), 'web source pill styling should exist');
assert(cssSource.includes('.work-process-step.is-appear'), 'step appear animation should exist');
assert(!cssSource.includes('.work-process-response'), 'response boundary styling must be removed');
assert(
  /\.work-process-step\.kind-section\s*\{[^}]*padding-bottom:\s*0/.test(cssSource),
  'section turns should zero bottom padding so turn gap is only the next section top pad',
);
assert(
  /\.work-process-section\s*\+\s*\.work-process-section\s*\{[^}]*padding-top:\s*var\(--space-3\)/.test(cssSource),
  'adjacent loop sections should share space-3 top padding as loop-boundary breath',
);
assert(
  /\.work-process-section-list\s*\{[^}]*margin:\s*var\(--space-3\)\s+0\s+0/.test(cssSource),
  'thinking/commentary → first tool should use space-3 entrance margin',
);
assert(
  !cssSource.includes('.work-process-section + .work-process-section:not(.has-prose)'),
  'non-prose section adjacency must not lock top padding to zero',
);
assert(
  /\.work-process\s*\+\s*\.conversation-bubble-assistant\s*\{[^}]*margin-top:\s*var\(--space-0-5\)/.test(cssSource),
  'final answer body should separate from the Work Process block with space-2 stack + space-0-5 (10px)',
);
assert(
  !/\.work-process\.is-collapsed\s*\+\s*\.conversation-bubble-assistant\s*\{[^}]*margin-top:/.test(cssSource),
  'collapsed and expanded should share the same 10px process-to-result break',
);
assert(
  /\.work-process-steps\s*>\s*\.work-process-step:last-child\s*\{[^}]*padding-bottom:\s*0/.test(cssSource),
  'last process step must zero bottom padding so expanded ends flush like collapsed',
);
assert(
  /\.work-process-section-list\s+\.work-process-step\s*\{[^}]*padding:\s*var\(--space-2\)\s+0\s+0/.test(cssSource),
  'nested tool rows should use top-only space-2 padding (denser than loop entrance / turn boundary)',
);
assert(
  cssSource.includes('.work-process.is-collapsed .work-process-label'),
  'collapsed Work Process header should use quieter caption chrome',
);
assert(
  /order:\s*1/.test(cssSource.match(/\.work-process-status-dot\s*\{[^}]+\}/)?.[0] ?? ''),
  'Work Process status dot should lead the header so its left edge can align with prose',
);
assert(
  !cssSource.includes('left: calc(-1 * (8px + var(--space-2)))'),
  'Work Process status dot must not hang left of the prose edge',
);
assert(
  /\.work-process-steps\s*\{[^}]*padding:\s*0\s+0\s+0\s+var\(--space-3\)/.test(cssSource)
    || /\.work-process-steps\s*\{[^}]*padding-left:\s*var\(--space-3\)/.test(cssSource),
  'loop turns should nest under the header status dot with space-3 indent',
);
assert(
  /\.conversation-thread\s*\{[^}]*padding-inline:\s*var\(--space-3\)/.test(cssSource),
  'transcript thread should keep shared inline gutters away from rail/scrollbar seams',
);
assert(
  !/\.work-process\s*\{[^}]*padding-inline-end:\s*var\(--space-3\)/.test(cssSource),
  'Work Process must not keep a WP-only right gutter; share the thread gutter instead',
);
assert(
  /\.work-process-step\s*\{[^}]*grid-template-columns:\s*8px\s+minmax\(0,\s*1fr\)/.test(cssSource),
  'loop rail column should stay compact (8px) so Thinking copy stays close to the gray node',
);
assert(
  /\.work-process-step\s*\{[^}]*column-gap:\s*var\(--space-1\)/.test(cssSource),
  'loop rail-to-thinking gap should be space-1',
);
assert(
  !/\.work-process-section-list\s*\{[^}]*padding-left:\s*calc\(14px\s*\+\s*var\(--space-1\)\)/.test(cssSource),
  'section tool rows must not keep spark-aligned padding-left; they share commentary left edge',
);
assert(
  /\.work-process-section-list\s*\{[^}]*padding:\s*0/.test(cssSource),
  'section tool list should use padding: 0 so tool cards align with commentary prose',
);
assert(cssSource.includes('.work-process-icon'), 'local tool icon styling should exist');
assert(cssSource.includes('.work-process-section-list'), 'section list styling should exist');
assert(cssSource.includes('.work-process-step-rail.status-complete'), 'rail marker color should be status-driven, not section-driven');
assert(cssSource.includes('.work-process-prose.is-streaming'), 'prose streaming indicator should exist');
assert(cssSource.includes('.work-process-tool-aggregate'), 'tool aggregate styling should exist');
assert(cssSource.includes('.work-process-section-list .work-process-step-rail'), 'nested tool rails must be suppressed under section lists');
assert(cssSource.includes('--work-process-rail-marker-size: 6px'), 'loop rail marker should be 6px');
assert(
  /margin-top:\s*calc\(\(var\(--text-sm\)\s*\*\s*1\.65\s*-\s*var\(--work-process-rail-marker-size\)\)\s*\/\s*2\)/.test(cssSource),
  'rail marker must center on the first text-sm line instead of a fixed space-3 drop',
);
assert(
  !/\.work-process-rail-marker\s*\{[^}]*margin-top:\s*var\(--space-3\)/.test(cssSource),
  'rail marker must not keep the legacy space-3 top offset',
);
assert(
  /\.work-process-summary\s*\{[^}]*margin:\s*0\s+0\s+var\(--space-2\)/.test(cssSource),
  'failure summary must use space-2 gap before diagnostic rows',
);
assert(
  !/\.work-process-label\.status-running\s*\{[^}]*\bcolor:/.test(cssSource),
  'running Work Process label must not set color that overrides Active Signal shimmer',
);
assert(cssSource.includes('@media (prefers-reduced-motion: reduce)'), 'streaming motion should honor reduced motion');
assert(cssSource.includes('.work-process-tool-approval'), 'tool approval styling should exist');
assert(cssSource.includes('.work-process-disclosure:not([open]) > :not(summary)'), 'closed disclosure must not render expanded body content');
assert(
  componentSource.includes('<MessageMarkdown content={row.thinkingPreview} />'),
  'thinking preview must render through MessageMarkdown',
);
assert(
  cssSource.includes('.work-process-thinking-preview .markdown-body'),
  'thinking preview must scope markdown-body styles',
);
assert(!cssSource.includes('.work-process-section-steps'), 'legacy tool-step disclosure CSS should be removed');
assert(!cssSource.includes('.work-process-step-rail.is-section .work-process-rail-marker'), 'section markers must not use a hierarchy-only color override');
assert(!cssSource.includes('.work-process-steps-toggle'), 'legacy tool-step toggle CSS should be removed');
assert(!cssSource.includes('.work-process-empty'), 'placeholder empty-state CSS should be removed');
assert(!appShellSource.includes('composerEnergyFlow'), 'composer running border must not use the legacy uniform sweep keyframe');
assert(appShellSource.includes('@keyframes composerEnergyOrbit'), 'composer running border orbit keyframe should exist');
assert(appShellSource.includes('.composer-shell.is-running::before'), 'composer running border core layer should exist');
assert(!appShellSource.includes('.composer-shell.is-running::after'), 'composer running halo must use drop-shadow bloom, not a second masked ring (reads as cut edges)');
assert(/is-running::before[\s\S]{0,900}drop-shadow/.test(appShellSource), 'composer running border bloom should follow the stroke via drop-shadow');
assert(appShellSource.includes('.composer-shell.is-running:focus-within'), 'composer running border must preserve the focus ring layer');
assert(appShellSource.includes('@media (prefers-reduced-motion: reduce)'), 'composer running border should honor reduced motion');
assert(appShellSource.includes('--composer-shell-radius: var(--radius-xl)'), 'composer shell radius must use the design-system radius scale');

assert(i18nSource.includes("'chat.workProcessTitle': 'Work process'"), 'English process title copy should be Work process');
assert(i18nSource.includes("'chat.workProcessTitle': '工作过程'"), 'Chinese process title copy should exist');
assert(i18nSource.includes("'chat.workProcessHeadlineRunning': 'Working'"), 'English running header copy should be Working');
assert(i18nSource.includes("'chat.workProcessHeadlineRunning': '工作中'"), 'Chinese running header copy should exist');
assert(i18nSource.includes("'chat.workProcessThoughtFor': 'Thought for {duration}'"), 'English Thought-for copy should exist');
assert(i18nSource.includes("'chat.workProcessThoughtFor': '已思考 · {duration}'"), 'Chinese Thought-for key should map to 已思考 · duration');
assert(!i18nSource.includes("'chat.workProcessThoughtFor': '思考了 {duration}'"), 'Chinese must not keep settled 思考了 Thought-for copy');
assert(!i18nSource.includes('深度思考'), 'i18n must not introduce 深度思考');
assert(i18nSource.includes("'chat.workProcessThinkingComplete': '已思考'"), 'Chinese durationless settled thinking fallback should exist');
assert(!i18nSource.includes("'chat.workProcessTitle': 'Thinking process'"), 'header must not reuse Thinking process title');
assert(!i18nSource.includes("'chat.workProcessThinkingComplete': 'Thinking process'"), 'settled thinking must not reuse Thinking process');
assert(!i18nSource.includes('Tool steps {count}'), 'English legacy tool-step copy should be removed');
assert(!i18nSource.includes('工具步骤'), 'Chinese legacy tool-step copy should be removed');
assert(!i18nSource.includes('Reasoning summary'), 'legacy reasoning label should not exist in i18n');
assert(!i18nSource.includes("'chat.workProcessTitle': 'Process'"), 'English Process title must be removed');
assert(presentationSource.includes('extractDiagnosticCaption'), 'failed tools should extract a human-readable diagnostic caption');
assert(presentationSource.includes('diagnosticCaption'), 'tool projection should expose diagnosticCaption');
assert(presentationSource.includes('unwrapToolContentLayer'), 'tool projection must unwrap content layer from result envelopes');
assert(presentationSource.includes("previewKind: 'shell'"), 'shell preview kind should be projected');
assert(componentSource.includes('work-process-shell-command'), 'shell tools should render a command pane');
assert(componentSource.includes('work-process-shell-stdout'), 'shell tools should render stdout');
assert(componentSource.includes('work-process-path-chip'), 'skill_read should render a path chip');
assert(componentSource.includes('FamilyLayerBody'), 'memory/skill/mcp/runtime/interpreter must use dedicated family layers');
assert(componentSource.includes('WorkProcessHighlightedCode'), 'interpreter cards must highlight code with the shared highlighter');
assert(componentSource.includes("family === 'memory'"), 'memory family must have a dedicated layer');
assert(componentSource.includes("family === 'skill'"), 'skill family must have a dedicated layer');
assert(componentSource.includes("family === 'mcp'"), 'mcp family must have a dedicated layer');
assert(componentSource.includes("family === 'runtime'"), 'runtime family must have a dedicated layer');
assert(cssSource.includes('.work-process-highlighted-code'), 'interpreter highlight styling should exist');
assert(!componentSource.includes('work-process-console-title'), 'Console output must not appear as a visible nested sub-label');
assert(!componentSource.includes('work-process-console-head'), 'Console chrome head with visible title must be removed');
assert(cssSource.includes('.work-process-shell-command'), 'shell command styling should exist');
assert(cssSource.includes('.work-process-tool-card-detail'), 'family detail styling should exist');
assert(cssSource.includes('.work-process-tool-diagnostic'), 'failed-tool diagnostic caption styling should exist');
assert(cssSource.includes('.work-process-tool-card.status-error .work-process-tool-card-verb'), 'failed tool verbs should use error color only on the verb');
assert(i18nSource.includes("'chat.workProcessShowDiagnostic': 'Show details'"), 'diagnostic detail affordance English copy should exist');
assert(i18nSource.includes("'chat.workProcessShowDiagnostic': '查看详情'"), 'diagnostic detail affordance Chinese copy should exist');
assert(!i18nSource.includes('workProcessShowLoopDetail'), 'grouped/detail view i18n keys must be removed');
assert(!i18nSource.includes('workProcessResponseTitle'), 'Reply boundary i18n keys must be removed');
assert(!i18nSource.includes('workProcessResponseGenerated'), 'Reply generated i18n keys must be removed');
assert(!i18nSource.includes('workProcessSemanticExplore'), 'semantic grouping i18n keys must be removed');

assert(!userInputPanelSource.includes('window.electronAPI'), 'composer user input panel must not call Electron APIs directly');
assert(userInputSubmitHookSource.includes('answerUserInput'), 'composer user input hook must submit through conversation.answerUserInput');
assert(!toolApprovalPanelSource.includes('window.electronAPI'), 'composer tool approval panel must not call Electron APIs directly');
assert(toolApprovalSubmitHookSource.includes('answerToolApproval'), 'composer tool approval hook must submit through conversation.answerToolApproval');
assert(!orchestratorSource.includes('User input requested by'), 'ask_user tool must not return fake user-request text immediately');

console.log('[work-process] OK');
