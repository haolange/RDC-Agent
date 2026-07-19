import { describe, expect, it } from 'vitest';
import type { ConversationWorkTrace } from '@shared/types/conversation';
import { buildWorkProcessPresentation } from './workProcessPresentation';

const now = 1_700_000_000_000;

function flattenWorkRows(rows: ReturnType<typeof buildWorkProcessPresentation>['rows']): Array<(typeof rows)[number]> {
  return rows.flatMap((row) => {
    if (row.type === 'section') return [row, ...flattenWorkRows(row.steps)];
    if (row.type === 'toolAggregate') return [row, ...row.children];
    return [row];
  });
}

describe('buildWorkProcessPresentation', () => {
  it('withholds unclassified streaming prose before tools arrive', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'running',
      summary: 'Agent is working',
      updatedAt: now,
      blocks: [
        {
          id: 'runtime-loop-1',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'running',
          result: { text: 'Hello from the assistant', status: 'streaming', toolCallIds: [] },
          toolCalls: [],
          startedAt: now,
        },
      ],
    });

    expect(presentation.rows).toHaveLength(0);
  });

  it('projects streaming commentary as prose without promoting it into thinking', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'running',
      updatedAt: now,
      blocks: [
        {
          id: 'runtime-loop-prose',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'running',
          result: {
            text: 'Inspecting capture metadata',
            status: 'streaming',
            toolCallIds: [],
            outputPhase: 'commentary',
          },
          toolCalls: [],
          startedAt: now,
        },
      ],
    });

    const section = presentation.rows.find((row) => row.type === 'section');
    expect(section).toMatchObject({
      type: 'section',
      proseText: 'Inspecting capture metadata',
      proseStreaming: true,
      thinkingLabel: '',
      thinkingExpandable: false,
    });
  });

  it('keeps settled commentary prose even when the loop has no tool calls', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'running',
      updatedAt: now + 2000,
      blocks: [
        {
          id: 'runtime-loop-ask',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: {
            text: 'Need a few answers first.',
            status: 'complete',
            toolCallIds: ['ask-1'],
            stopReason: 'tool_use',
            outputPhase: 'commentary',
          },
          toolCalls: [
            {
              id: 'ask-1',
              toolName: 'ask_user',
              status: 'complete',
              argsPreview: JSON.stringify({ questions: [{ prompt: 'Drink?' }] }),
              resultPreview: JSON.stringify({ answers: [{ answer: '茶' }] }),
              startedAt: now,
              completedAt: now + 500,
            },
          ],
          startedAt: now,
          completedAt: now + 500,
        },
        {
          id: 'runtime-loop-commentary',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: {
            text: 'Thanks — summarizing the parameter combinations next.',
            status: 'complete',
            toolCallIds: [],
            stopReason: 'end_turn',
            outputPhase: 'commentary',
          },
          toolCalls: [],
          startedAt: now + 600,
          completedAt: now + 900,
        },
      ],
    });

    const sections = presentation.rows.filter((row) => row.type === 'section');
    expect(sections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'section',
        proseText: 'Need a few answers first.',
      }),
      expect.objectContaining({
        type: 'section',
        proseText: 'Thanks — summarizing the parameter combinations next.',
      }),
    ]));
  });

  it('does not project settled final_answer text into Work Process prose', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now + 3000,
      blocks: [
        {
          id: 'runtime-loop-process',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: {
            text: 'Checking files.',
            status: 'complete',
            toolCallIds: ['tool-read'],
            stopReason: 'tool_use',
            outputPhase: 'commentary',
          },
          toolCalls: [
            {
              id: 'tool-read',
              toolName: 'read_file',
              status: 'complete',
              argsPreview: JSON.stringify({ path: 'a.ts' }),
              resultPreview: JSON.stringify({ ok: true }),
              startedAt: now + 100,
              completedAt: now + 200,
            },
          ],
          startedAt: now,
          completedAt: now + 200,
        },
        {
          id: 'runtime-loop-final',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: {
            text: 'Final answer body only',
            status: 'complete',
            toolCallIds: [],
            stopReason: 'end_turn',
            outputPhase: 'final_answer',
          },
          toolCalls: [],
          startedAt: now + 300,
          completedAt: now + 400,
        },
      ],
    });

    const finalSection = presentation.rows.find((row) => (
      row.type === 'section' && row.proseText === 'Final answer body only'
    ));
    expect(finalSection).toBeUndefined();
    expect(presentation.rows.some((row) => (
      row.type === 'section' && row.proseText === 'Checking files.'
    ))).toBe(true);
  });

  it('keeps streaming final_answer text out of Work Process prose', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'running',
      updatedAt: now + 3100,
      blocks: [
        {
          id: 'runtime-loop-ask',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: {
            text: 'Need a few answers first.',
            status: 'complete',
            toolCallIds: [],
            stopReason: 'end_turn',
            outputPhase: 'commentary',
          },
          toolCalls: [],
          startedAt: now,
          completedAt: now + 200,
        },
        {
          id: 'runtime-user-input',
          kind: 'user_input',
          title: 'User input requested',
          status: 'complete',
          result: {
            text: '',
            status: 'complete',
            toolCallIds: ['ask-batch'],
          },
          toolCalls: [
            {
              id: 'ask-batch',
              toolName: 'ask_user',
              status: 'complete',
              argsPreview: JSON.stringify({
                questions: [
                  { prompt: 'Drink?' },
                  { prompt: 'Quality?' },
                ],
              }),
              resultPreview: JSON.stringify({
                answers: [{ answer: '茶' }, { answer: '还行' }],
              }),
              startedAt: now + 200,
              completedAt: now + 400,
            },
          ],
          startedAt: now + 200,
          completedAt: now + 400,
        },
        {
          id: 'runtime-loop-final-stream',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'running',
          result: {
            text: 'Streaming final answer tokens after ask_user.',
            status: 'streaming',
            toolCallIds: [],
            outputPhase: 'final_answer',
          },
          toolCalls: [],
          startedAt: now + 500,
        },
      ],
    });

    expect(presentation.rows.some((row) => (
      row.type === 'section'
      && row.proseText === 'Streaming final answer tokens after ask_user.'
    ))).toBe(false);
    expect(presentation.rows.some((row) => (
      row.type === 'section' && row.proseText === 'Need a few answers first.'
    ))).toBe(true);
  });

  it('uses Thought-for settled labels with duration to the first tool', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now + 1000,
      blocks: [
        {
          id: 'runtime-loop-thought',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { text: 'Read files before answering.', status: 'complete', toolCallIds: ['tool-read'] },
          thinking: {
            text: 'raw chain-of-thought that must not be result text',
            kind: 'raw',
            source: 'openai-compatible-raw',
            visibility: 'raw-collapsed',

          },
          thinkingStatus: 'complete',
          toolCalls: [
            {
              id: 'tool-read',
              toolName: 'read_file',
              status: 'complete',
              argsPreview: JSON.stringify({ path: 'README.md' }),
              resultPreview: JSON.stringify({ content: 'hello' }),
              startedAt: now + 1500,
              completedAt: now + 1600,
            },
          ],
          startedAt: now,
          completedAt: now + 1600,
        },
      ],
    });

    const section = presentation.rows.find((row) => row.type === 'section');
    expect(section).toMatchObject({
      type: 'section',
      proseText: 'Read files before answering.',
      thinkingLabel: '已思考 · 1.5s',
      thinkingPreview: 'raw chain-of-thought that must not be result text',
      thinkingExpandable: true,
      thinkingOpenByDefault: false,
    });
  });

  it('uses streaming Thinking label while the loop is active', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'running',
      updatedAt: now,
      blocks: [
        {
          id: 'runtime-loop-stream',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'running',
          result: { text: 'Working…', status: 'streaming', toolCallIds: ['tool-glob'] },
          thinking: {
            text: 'planning next step',
            kind: 'summary',
            source: 'anthropic-thinking',
            visibility: 'summary',

          },
          thinkingStatus: 'streaming',
          toolCalls: [
            {
              id: 'tool-glob',
              toolName: 'glob',
              status: 'running',
              argsPreview: JSON.stringify({ pattern: '**/*' }),
              startedAt: now + 100,
            },
          ],
          startedAt: now,
        },
      ],
    });

    const section = presentation.rows.find((row) => row.type === 'section');
    expect(section).toMatchObject({
      type: 'section',
      thinkingLabel: '正在思考',
      thinkingExpandable: true,
    });
  });

  it('falls back to durationless 已思考 when timestamps are missing', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now,
      blocks: [
        {
          id: 'runtime-loop-no-time',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { text: 'Done.', status: 'complete', toolCallIds: [] },
          thinking: {
            text: 'summary only',
            kind: 'summary',
            source: 'anthropic-thinking',
            visibility: 'summary',

          },
          thinkingStatus: 'complete',
          toolCalls: [],
          startedAt: undefined as unknown as number,
          completedAt: undefined,
        },
      ],
    });

    // Without startedAt the loop may not project duration; if section exists, label must not reuse 思考过程.
    const section = presentation.rows.find((row) => row.type === 'section');
    if (section?.type === 'section' && section.thinkingLabel) {
      expect(section.thinkingLabel).toMatch(/^(已思考|已思考 · )/);
      expect(section.thinkingLabel).not.toBe('思考过程');
      expect(section.thinkingLabel).not.toMatch(/思考了|深度思考/);
    }
  });

  it('aggregates eight consecutive tools into one toolAggregate row', () => {
    const toolCallIds = Array.from({ length: 8 }, (_, index) => `tool-read-${index}`);
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now,
      blocks: [
        {
          id: 'runtime-loop-explore',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { status: 'complete', toolCallIds },
          toolCalls: toolCallIds.map((id, index) => ({
            id,
            toolName: 'read_file',
            status: 'complete',
            argsPreview: JSON.stringify({ path: `docs/${index}.md` }),
            resultPreview: JSON.stringify({ content: `document ${index}` }),
            startedAt: now + index * 10,
            completedAt: now + index * 10 + 5,
          })),
          startedAt: now,
          completedAt: now + 30,
        },
      ],
    });

    const section = presentation.rows.find((row) => row.type === 'section');
    const visibleSteps = section?.type === 'section' ? section.visibleSteps : [];
    expect(visibleSteps).toHaveLength(1);
    expect(visibleSteps[0]?.type).toBe('toolAggregate');
    expect(visibleSteps[0]?.type === 'toolAggregate' ? visibleSteps[0].children : []).toHaveLength(8);
    expect(section?.type === 'section' ? section.steps : []).toHaveLength(8);
  });

  it('keeps seven consecutive tools flat without aggregation', () => {
    const toolCallIds = Array.from({ length: 7 }, (_, index) => `tool-flat-${index}`);
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now,
      blocks: [
        {
          id: 'runtime-loop-two',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { status: 'complete', toolCallIds },
          toolCalls: toolCallIds.map((id, index) => ({
            id,
            toolName: 'read_file',
            status: 'complete',
            argsPreview: JSON.stringify({ path: `${index}.md` }),
            resultPreview: '{}',
            startedAt: now + index * 10,
            completedAt: now + index * 10 + 5,
          })),
          startedAt: now,
          completedAt: now + 10,
        },
      ],
    });

    const section = presentation.rows.find((row) => row.type === 'section');
    const visibleSteps = section?.type === 'section' ? section.visibleSteps : [];
    expect(visibleSteps.map((row) => row.type)).toEqual(Array(7).fill('tool'));
  });

  it('preserves info, warning, and error diagnostic severity in Work Process rows', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'error',
      updatedAt: now,
      blocks: [
        {
          id: 'diagnostic-info',
          kind: 'diagnostic',
          title: 'Catalog evidence refreshed',
          status: 'complete',
          diagnosticSeverity: 'info',
          toolCalls: [],
          startedAt: now,
          completedAt: now + 1,
        },
        {
          id: 'diagnostic-warning',
          kind: 'diagnostic',
          title: 'Structured tools are unsupported',
          status: 'complete',
          diagnosticSeverity: 'warning',
          toolCalls: [],
          startedAt: now + 2,
          completedAt: now + 3,
        },
        {
          id: 'diagnostic-error',
          kind: 'diagnostic',
          title: 'Route is unavailable',
          status: 'error',
          diagnosticSeverity: 'error',
          toolCalls: [],
          startedAt: now + 4,
          completedAt: now + 5,
        },
      ],
    });

    expect(presentation.rows.filter((row) => row.type === 'diagnostic')).toEqual([
      expect.objectContaining({ id: 'diagnostic-info', severity: 'info' }),
      expect.objectContaining({ id: 'diagnostic-warning', severity: 'warning' }),
      expect.objectContaining({ id: 'diagnostic-error', severity: 'error' }),
    ]);
  });

  it('exposes a human-readable diagnosticCaption for failed tools without JSON envelope', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'error',
      updatedAt: now,
      blocks: [
        {
          id: 'runtime-loop-git-fail',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'error',
          result: { text: 'Checking git root.', status: 'complete', toolCallIds: ['tool-git'] },
          toolCalls: [
            {
              id: 'tool-git',
              toolName: 'bash',
              status: 'error',
              argsPreview: JSON.stringify({ command: 'git rev-parse --show-toplevel' }),
              resultPreview: JSON.stringify({
                ok: false,
                data: {},
                error: {
                  code: 'AGENT_TOOL_FAILED',
                  message: 'fatal: not a git repository (or any of the parent directories): .git',
                },
              }),
              startedAt: now,
              completedAt: now + 20,
            },
          ],
          startedAt: now,
          completedAt: now + 20,
        },
      ],
    });

    const tool = flattenWorkRows(presentation.rows).find((row) => row.type === 'tool');
    expect(tool).toMatchObject({
      type: 'tool',
      status: 'error',
      verb: '执行失败',
      diagnosticCaption: 'fatal: not a git repository (or any of the parent directories): .git',
    });
    expect(tool?.type === 'tool' ? tool.diagnosticCaption : '').not.toMatch(/^\s*\{/);
  });

  it('folds answer-only follow-up thinking into a quiet section and omits Reply boundaries', () => {
    const withThinking = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now + 100,
      blocks: [
        {
          id: 'runtime-loop-tools',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { text: 'Inspecting.', status: 'complete', toolCallIds: ['tool-1'] },
          toolCalls: [
            {
              id: 'tool-1',
              toolName: 'glob',
              status: 'complete',
              argsPreview: JSON.stringify({ pattern: '*' }),
              resultPreview: '{}',
              startedAt: now,
              completedAt: now + 10,
            },
          ],
          startedAt: now,
          completedAt: now + 10,
        },
        {
          id: 'runtime-loop-answer',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { text: 'Final answer body', status: 'complete', toolCallIds: [], stopReason: 'end_turn', outputPhase: 'final_answer' },
          thinking: {
            text: 'Closing thoughts before the reply.',
            kind: 'summary',
            source: 'anthropic-thinking',
            visibility: 'summary',

          },
          thinkingStatus: 'complete',
          toolCalls: [],
          startedAt: now + 20,
          completedAt: now + 40,
        },
      ],
    });

    expect(withThinking.rows.every((row) => row.type !== 'response' as string)).toBe(true);
    const closing = withThinking.rows.filter((row) => row.type === 'section').at(-1);
    expect(closing).toMatchObject({
      type: 'section',
      thinkingPreview: 'Closing thoughts before the reply.',
      thinkingExpandable: true,
      stepCount: 0,
    });

    const withoutThinking = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now + 100,
      blocks: [
        {
          id: 'runtime-loop-tools-2',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { text: 'Inspecting.', status: 'complete', toolCallIds: ['tool-2'] },
          toolCalls: [
            {
              id: 'tool-2',
              toolName: 'glob',
              status: 'complete',
              argsPreview: JSON.stringify({ pattern: '*' }),
              resultPreview: '{}',
              startedAt: now,
              completedAt: now + 10,
            },
          ],
          startedAt: now,
          completedAt: now + 10,
        },
        {
          id: 'runtime-loop-answer-silent',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { text: 'Final answer body', status: 'complete', toolCallIds: [], stopReason: 'end_turn', outputPhase: 'final_answer' },
          toolCalls: [],
          startedAt: now + 20,
          completedAt: now + 40,
        },
      ],
    });
    expect(withoutThinking.rows.every((row) => row.type !== 'response' as string)).toBe(true);
    expect(withoutThinking.rows.filter((row) => row.type === 'section')).toHaveLength(1);
  });

  it('is deterministic for the same trace', () => {
    const trace: ConversationWorkTrace = {
      status: 'complete',
      updatedAt: now,
      blocks: [
        {
          id: 'runtime-loop-stable',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { text: 'Stable.', status: 'complete', toolCallIds: ['t1'] },
          thinking: {
            text: 'think',
            kind: 'summary',
            source: 'anthropic-thinking',
            visibility: 'summary',

          },
          thinkingStatus: 'complete',
          toolCalls: [
            {
              id: 't1',
              toolName: 'glob',
              status: 'complete',
              argsPreview: JSON.stringify({ pattern: '*' }),
              resultPreview: '{}',
              startedAt: now + 200,
              completedAt: now + 220,
            },
          ],
          startedAt: now,
          completedAt: now + 220,
        },
      ],
    };

    expect(buildWorkProcessPresentation(trace)).toEqual(buildWorkProcessPresentation(trace));
  });

  it('unwraps bash envelope into shell content-layer preview without ok/trace_id', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now + 500,
      blocks: [
        {
          id: 'runtime-loop-bash',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { text: 'Checked types.', status: 'complete', toolCallIds: ['tool-bash'] },
          toolCalls: [
            {
              id: 'tool-bash',
              toolName: 'bash',
              status: 'complete',
              argsPreview: JSON.stringify({ command: 'npm run typecheck' }),
              resultPreview: JSON.stringify({
                ok: true,
                data: {
                  content: [{ type: 'text', text: '> tsc\nFound 0 errors.' }],
                  details: { command: 'npm run typecheck', exitCode: 0, durationMs: 120 },
                },
                duration_ms: 120,
                trace_id: 'tool-bash',
              }),
              startedAt: now,
              completedAt: now + 120,
            },
          ],
          startedAt: now,
          completedAt: now + 120,
        },
      ],
    });

    const bashRow = flattenWorkRows(presentation.rows).find(
      (row) => row.type === 'tool' && row.toolName === 'bash',
    );
    expect(bashRow).toMatchObject({
      type: 'tool',
      family: 'shell',
      previewKind: 'shell',
      commandText: 'npm run typecheck',
    });
    if (!bashRow || bashRow.type !== 'tool') throw new Error('expected bash tool row');
    const preview = bashRow.previewLines.join('\n');
    expect(preview).toContain('Found 0 errors.');
    expect(preview).not.toContain('trace_id');
    expect(preview).not.toContain('duration_ms');
    expect(preview).not.toMatch(/"ok"\s*:/);
    expect(bashRow.rawLines.join('\n')).toContain('trace_id');
  });

  it('projects skill_read as a short description plus path chip, not full markdown', () => {
    const skillMarkdown = [
      '---',
      'name: arming-thought',
      'description: Establish qiushi principles at conversation start.',
      '---',
      '',
      '# Arming Thought',
      '',
      'Long body that must not fill the preview pane.',
      '',
      '## More',
      '',
      `${'x'.repeat(400)}`,
    ].join('\n');
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now + 500,
      blocks: [
        {
          id: 'runtime-loop-skill',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { text: 'Loaded skill.', status: 'complete', toolCallIds: ['tool-skill'] },
          toolCalls: [
            {
              id: 'tool-skill',
              toolName: 'skill_read',
              status: 'complete',
              argsPreview: JSON.stringify({ skill_id: 'arming-thought' }),
              resultPreview: JSON.stringify({
                ok: true,
                data: {
                  content: [{ type: 'text', text: skillMarkdown }],
                  details: {
                    skillId: 'arming-thought',
                    description: 'Establish qiushi principles at conversation start.',
                    sourcePath: 'C:/Users/Vip/.codex/skills/arming-thought/SKILL.md',
                  },
                },
                duration_ms: 40,
                trace_id: 'tool-skill',
              }),
              startedAt: now,
              completedAt: now + 40,
            },
          ],
          startedAt: now,
          completedAt: now + 40,
        },
      ],
    });

    const skillRow = flattenWorkRows(presentation.rows).find(
      (row) => row.type === 'tool' && row.toolName === 'skill_read',
    );
    expect(skillRow).toMatchObject({
      type: 'tool',
      family: 'generic',
      previewKind: 'skill',
      target: 'arming-thought',
      pathChip: 'C:/Users/Vip/.codex/skills/arming-thought/SKILL.md',
    });
    if (!skillRow || skillRow.type !== 'tool') throw new Error('expected skill tool row');
    expect(skillRow.previewLines).toHaveLength(1);
    expect(skillRow.previewLines[0]).toContain('Establish qiushi');
    expect(skillRow.previewLines.join('\n')).not.toContain('Long body that must not fill');
    expect(skillRow.previewLines.join('\n')).not.toContain('trace_id');
    expect(skillRow.rawLines.join('\n')).toContain('Long body that must not fill');
  });

  it('strips Unicode line gutters and projects file preview kind', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now + 600,
      blocks: [
        {
          id: 'runtime-loop-file',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { text: 'Read yaml.', status: 'complete', toolCallIds: ['tool-read'] },
          toolCalls: [
            {
              id: 'tool-read',
              toolName: 'read_file',
              status: 'complete',
              argsPreview: JSON.stringify({ path: '.rdx/project.yaml' }),
              resultPreview: JSON.stringify({
                ok: true,
                data: { content: [{ type: 'text', text: '1→schema_version: "1"\n2→name: "rdc"' }] },
              }),
              startedAt: now,
              completedAt: now + 20,
            },
          ],
          startedAt: now,
          completedAt: now + 20,
        },
      ],
    });

    const readRow = flattenWorkRows(presentation.rows).find(
      (row) => row.type === 'tool' && row.toolName === 'read_file',
    );
    expect(readRow).toMatchObject({
      type: 'tool',
      family: 'file',
      previewKind: 'file',
      pathChip: '.rdx/project.yaml',
    });
    if (!readRow || readRow.type !== 'tool') throw new Error('expected read tool row');
    expect(readRow.previewLines.join('\n')).toContain('schema_version');
    expect(readRow.previewLines.join('\n')).not.toContain('→');
  });

  it('projects glob outcome-first body from production envelope details', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now + 16,
      blocks: [
        {
          id: 'runtime-loop-glob',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { text: 'Listed.', status: 'complete', toolCallIds: ['tool-glob'] },
          toolCalls: [
            {
              id: 'tool-glob',
              toolName: 'glob',
              status: 'complete',
              argsPreview: JSON.stringify({ pattern: '**/*' }),
              resultPreview: JSON.stringify({
                ok: true,
                data: {
                  content: [{ type: 'text', text: 'src/a.ts\nsrc/b.ts\nREADME.md' }],
                  details: { pattern: '**/*', cwd: '.', matched: 3, truncated: false },
                },
                duration_ms: 16,
              }),
              startedAt: now,
              completedAt: now + 16,
            },
          ],
          startedAt: now,
          completedAt: now + 16,
        },
      ],
    });

    const globRow = flattenWorkRows(presentation.rows).find(
      (row) => row.type === 'tool' && row.toolName === 'glob',
    );
    if (!globRow || globRow.type !== 'tool') throw new Error('expected glob tool row');
    expect(globRow.family).toBe('search');
    expect(globRow.bodyText).toBe('3 files');
    expect(globRow.bodyText).not.toBe('**/*');
    expect(globRow.bodyLines).toEqual(['src/a.ts', 'src/b.ts', 'README.md']);
    expect(globRow.previewLines).toContain('src/a.ts');
    expect(globRow.target).toBe('**/*');
  });

  it('projects read_file totalLines into collapsed bodyText', () => {
    const presentation = buildWorkProcessPresentation({
      status: 'complete',
      updatedAt: now + 10,
      blocks: [
        {
          id: 'runtime-loop-read-lines',
          kind: 'llm_turn',
          title: 'LLM turn',
          status: 'complete',
          result: { text: 'Read.', status: 'complete', toolCallIds: ['tool-read-lines'] },
          toolCalls: [
            {
              id: 'tool-read-lines',
              toolName: 'read_file',
              status: 'complete',
              argsPreview: JSON.stringify({ path: 'DESIGN.md' }),
              resultPreview: JSON.stringify({
                ok: true,
                data: {
                  content: [{ type: 'text', text: '     1→# Design\n     2→body' }],
                  details: { path: 'DESIGN.md', totalLines: 240, offset: 1, limit: 2000, truncated: false },
                },
              }),
              startedAt: now,
              completedAt: now + 10,
            },
          ],
          startedAt: now,
          completedAt: now + 10,
        },
      ],
    });

    const readRow = flattenWorkRows(presentation.rows).find(
      (row) => row.type === 'tool' && row.toolName === 'read_file',
    );
    if (!readRow || readRow.type !== 'tool') throw new Error('expected read tool row');
    expect(readRow.bodyText).toBe('DESIGN.md · 240 lines');
    expect(readRow.pathChip).toBe('DESIGN.md');
  });
});
