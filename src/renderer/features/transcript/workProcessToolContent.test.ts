import { describe, expect, it } from 'vitest';
import { createWorkTraceFixture } from '@shared/fixtures/workTraceFixture';
import { localizedTranslator } from '../../i18n/messages';
import { createToolRowForPresentation } from './workProcessToolRows';
import { unwrapToolContentLayer } from './workProcessToolContent';

const t = localizedTranslator('en');
const envelope = (text: string, details: Record<string, unknown> = {}) =>
  JSON.stringify({ ok: true, data: { content: [{ type: 'text', text }], details } });
const present = (toolName: string, raw: string, args: unknown = {}) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = raw;
  }
  return unwrapToolContentLayer(toolName, parsed, raw, JSON.stringify(args), t);
};

describe('tool result presentation by tool type', () => {
  it('presents a real-shaped work trace: reads as files, searches as matches, commands as shell output', () => {
    const trace = createWorkTraceFixture({ steps: 4, resultPreviewChars: 120 });
    const rows = trace.blocks
      .flatMap((block) => block.toolCalls ?? [])
      .map((call) => createToolRowForPresentation(call, t));
    const line = (step: number) =>
      `step ${step}: ${'resource 0x1f2e binding t3 format R8G8B8A8_UNORM; '.repeat(3)}`.slice(0, 120);
    expect(
      rows.map(
        (row) =>
          row.type === 'tool' && {
            family: row.family,
            previewKind: row.previewKind,
            pathChip: row.pathChip,
            commandText: row.commandText,
            bodyText: row.bodyText,
            previewLines: row.previewLines,
          },
      ),
    ).toEqual([
      {
        family: 'file',
        previewKind: 'file',
        pathChip: 'src/shaders/pass_0.hlsl',
        commandText: undefined,
        bodyText: undefined,
        previewLines: [line(0)],
      },
      {
        family: 'search',
        previewKind: 'generic',
        pathChip: undefined,
        commandText: undefined,
        bodyText: '1 match',
        previewLines: [line(1)],
      },
      {
        family: 'shell',
        previewKind: 'shell',
        pathChip: undefined,
        commandText: 'rdc call rd.event.get_drawcall --args-json \'{"eventId":2002}\'',
        bodyText: undefined,
        previewLines: [line(2)],
      },
      {
        family: 'file',
        previewKind: 'file',
        pathChip: 'src/shaders/pass_3.hlsl',
        commandText: undefined,
        bodyText: undefined,
        previewLines: [],
      },
    ]);
  });

  it('picks the presenter by tool type, with MCP, memory and shell-like names sharing theirs', () => {
    expect(
      present('read_file', envelope('line one\nline two', { path: 'a.txt', totalLines: 2 }), { path: 'a.txt' }),
    ).toEqual({ previewKind: 'file', pathChip: 'a.txt', bodyText: '2 lines', previewLines: ['line one', 'line two'] });
    expect(present('write_file', envelope('Created'), { path: 'w.txt' })).toEqual({
      previewKind: 'file',
      pathChip: 'w.txt',
      previewLines: ['Created'],
    });
    expect(present('shell', envelope('ok', { command: 'ls' }), { command: 'ls' })).toEqual({
      previewKind: 'shell',
      commandText: 'ls',
      previewLines: [],
    });
    expect(present('mcp__ops__run_shell', envelope('ok'), { cmd: 'echo' })).toEqual({
      previewKind: 'shell',
      commandText: 'echo',
      previewLines: [],
    });
    expect(present('Shell-Exec', envelope('out'), { command: 'x' })).toEqual({
      previewKind: 'shell',
      commandText: 'x',
      previewLines: ['out'],
    });
    expect(present('code_interpreter', envelope('42'), { code: 'print(42)' })).toEqual({
      previewKind: 'shell',
      commandText: 'print(42)',
      bodyText: 'print(42)',
      previewLines: ['42'],
    });
    expect(present('mcp__docs__search', envelope('hit one'), { path: 'p' })).toEqual({
      previewKind: 'generic',
      chips: ['MCP · docs', 'search'],
      pathChip: 'p',
      bodyText: 'hit one',
      previewLines: ['hit one'],
    });
    expect(present('memory_search', envelope('found'), { query: 'q', scope: 'user' })).toEqual({
      previewKind: 'generic',
      chips: ['q', 'user'],
      bodyText: 'found',
      previewLines: ['found'],
    });
    expect(present('skill_read', envelope('---\ndescription: Does things\n---'), { skill_id: 'x' })).toEqual({
      previewKind: 'skill',
      bodyText: 'Does things',
      previewLines: ['Does things'],
      chips: ['x'],
    });
    expect(present('skills', JSON.stringify({ skills: ['a', 'b'] }))).toEqual({
      previewKind: 'generic',
      chips: ['a', 'b'],
      bodyText: '2 skills',
      previewLines: ['a', 'b'],
    });
    expect(present('tool_search', JSON.stringify({ matches: ['read_file', 'grep'] }))).toEqual({
      previewKind: 'generic',
      bodyText: '2 tools',
      bodyLines: ['File reading', 'Code search'],
      previewLines: ['File reading', 'Code search'],
    });
    expect(present('plan_artifact', envelope('plan'), { path: 'plan.md' })).toEqual({
      previewKind: 'generic',
      pathChip: 'plan.md',
      bodyText: 'plan.md',
      previewLines: ['plan'],
    });
    expect(present('grep', envelope('a:1: x', { matched: 3 }), { pattern: 'x' })).toEqual({
      previewKind: 'generic',
      bodyText: '3 matches',
      bodyLines: ['a:1: x'],
      previewLines: ['a:1: x'],
    });
    expect(present('glob', envelope('a\nb'), { pattern: '*' })).toEqual({
      previewKind: 'generic',
      bodyText: '2 files',
      bodyLines: ['a', 'b'],
      previewLines: ['a', 'b'],
    });
    expect(present('web_search', envelope('Search query: x'), { query: 'x' })).toEqual({
      previewKind: 'web',
      previewLines: [],
    });
    expect(present('custom.tool', envelope('custom output'))).toEqual({
      previewKind: 'generic',
      bodyText: 'custom output',
      bodyLines: ['custom output'],
      previewLines: ['custom output'],
    });
  });

  it('presents any result moved into a session file from its display gist, whatever the tool', () => {
    expect(
      present(
        'artifact_read',
        envelope('Offloaded', { artifactized: true, ref: 'session://x', display: { kind: 'file', path: 'b.txt' } }),
        { uri: 'session://x' },
      ),
    ).toEqual({ previewKind: 'file', pathChip: 'b.txt', previewLines: ['Offloaded'] });
    expect(
      present('web_fetch', envelope('Gist', { artifactized: true, display: { kind: 'command', command: 'ls' } })),
    ).toEqual({ previewKind: 'shell', commandText: 'ls', bodyText: 'ls', previewLines: ['Gist'] });
  });
});
