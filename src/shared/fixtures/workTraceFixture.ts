import type { ConversationToolCall, ConversationWorkBlock, ConversationWorkTrace } from '../types/conversation';

/**
 * A work trace shaped like a real investigation: every model step thinks, streams a short note and calls one tool,
 * tools rotate through reads, searches and shell commands with result previews of realistic size, and the last step
 * is still running. Main and renderer tests build traces of any length from it to measure per-step costs.
 */
export interface WorkTraceFixtureOptions {
  steps: number;
  /** Characters in each tool result preview. */
  resultPreviewChars?: number;
  /** When the first step started; each later step starts one second after the previous. */
  startedAt?: number;
  running?: boolean;
}

const TOOLS = [
  { toolName: 'read_file', args: (step: number) => ({ path: `src/shaders/pass_${step % 12}.hlsl`, offset: 0, limit: 200 }) },
  { toolName: 'grep', args: (step: number) => ({ pattern: `TEXCOORD${step % 4}`, path: 'src/shaders', output_mode: 'content' }) },
  { toolName: 'shell', args: (step: number) => ({ command: `rdc call rd.event.get_drawcall --args-json '{"eventId":${2000 + step}}'` }) },
] as const;

function toolCall(step: number, startedAt: number, running: boolean, resultPreviewChars: number): ConversationToolCall {
  const tool = TOOLS[step % TOOLS.length]!;
  const result = `step ${step}: ` + 'resource 0x1f2e binding t3 format R8G8B8A8_UNORM; '.repeat(Math.ceil(resultPreviewChars / 52));
  return {
    id: `call-${step}`,
    toolName: tool.toolName,
    status: running ? 'running' : 'success',
    providerOutputRef: { protocol: 'fixture', providerBlockKey: `tool-${step}`, sourceIndex: 2 },
    argsPreview: JSON.stringify(tool.args(step)),
    ...(running ? {} : { resultPreview: result.slice(0, resultPreviewChars) }),
    displayOrder: 2,
    startedAt: startedAt + 600,
    ...(running ? {} : { completedAt: startedAt + 900 }),
  } as ConversationToolCall;
}

function llmStep(step: number, startedAt: number, running: boolean, resultPreviewChars: number): ConversationWorkBlock {
  return {
    id: `loop-${step}`,
    kind: 'llm_turn',
    title: `Step ${step + 1}`,
    status: running ? 'running' : 'complete',
    items: [
      {
        kind: 'thinking',
        providerOutputRef: { protocol: 'fixture', providerBlockKey: `thinking-${step}`, sourceIndex: 0 },
        thinking: {
          text: `The pass ${step % 12} output looks darker than its input; check what binds t3 before draw ${2000 + step}.`,
          kind: 'summary', source: 'anthropic-thinking', visibility: 'summary',
        },
        status: 'complete',
        displayOrder: 0,
        startedAt,
        completedAt: startedAt + 300,
      },
      {
        kind: 'text',
        providerOutputRef: { protocol: 'fixture', providerBlockKey: `text-${step}`, sourceIndex: 1 },
        text: `Reading the binding for draw ${2000 + step}.`,
        status: 'complete',
        displayOrder: 1,
      },
    ],
    toolCalls: [toolCall(step, startedAt, running, resultPreviewChars)],
    startedAt,
    ...(running ? {} : { completedAt: startedAt + 1000 }),
  } as ConversationWorkBlock;
}

export function createWorkTraceFixture(options: WorkTraceFixtureOptions): ConversationWorkTrace {
  const startedAt = options.startedAt ?? Date.parse('2026-11-25T00:00:00.000Z');
  const running = options.running ?? true;
  const resultPreviewChars = options.resultPreviewChars ?? 2_000;
  const blocks = Array.from({ length: options.steps }, (_, step) => llmStep(
    step, startedAt + step * 1_000, running && step === options.steps - 1, resultPreviewChars,
  ));
  return { status: running ? 'running' : 'complete', blocks, updatedAt: startedAt + options.steps * 1_000 };
}
