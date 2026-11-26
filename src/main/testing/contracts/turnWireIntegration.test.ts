import { createServer, type IncomingMessage, type Server } from 'node:http';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileProviderCatalog } from '../../provider-catalog/catalogCompiler';
import { loadProviderCatalogManifestInput } from '../../provider-catalog/manifestLoader';
import { agentLoop, type ToolExecutor } from '../../agent-runtime/agent/AgentLoop';
import { AgentToolApprovalRequestService } from '../../agent-runtime/permissions/AgentToolApprovalRequestService';
import { OllamaProvider } from '../../agent-runtime/providers/OllamaProvider';
import { createTestRequestPlan } from '../createTestRequestPlan';
import type { AddressInfo } from 'node:net';
import type {
  AgentLoopEvent,
  AssistantMessage,
  Message,
  Model,
  ToolResultMessage,
} from '../../agent-runtime/core/types';

vi.mock('../../runtime/AuditLog', () => ({ auditLog: { record: vi.fn() } }));

/**
 * One turn across the real seams, in process: an Ollama wire stream served over HTTP → the product's Ollama
 * adapter → the agent loop → the tool approval service answered like the UI → the tool result replayed on
 * the wire → the final answer. Only the tool's effect and the person's click are stand-ins.
 */

const MODEL: Model = {
  id: 'qa-stub:4b',
  name: 'qa-stub:4b',
  provider: 'ollama',
  api: 'ollama',
  contextWindow: 32_768,
  maxTokens: 4_096,
  reasoning: true,
  vision: false,
};

const WRITE_TOOL = {
  name: 'write_file',
  description: 'Write a file in the workspace.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' }, content: { type: 'string' } },
    required: ['path', 'content'],
  },
};

const line = (message: Record<string, unknown>, done = false) =>
  `${JSON.stringify({
    model: MODEL.id,
    created_at: '2026-11-20T00:00:00Z',
    message: { role: 'assistant', content: '', ...message },
    done,
    ...(done ? { done_reason: 'stop', prompt_eval_count: 900, eval_count: 40 } : {}),
  })}\n`;

interface WireRequest {
  body: Record<string, unknown>;
}

function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((done, reject) => {
    let raw = '';
    request.on('data', (chunk) => {
      raw += chunk;
    });
    request.on('end', () => {
      try {
        done(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
  });
}

/** Scripted Ollama: first request thinks and asks to write a file; once a tool result arrives it answers. */
async function startWire(requests: WireRequest[]): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/api/chat') {
      response.writeHead(404).end();
      return;
    }
    const body = await readBody(request);
    requests.push({ body });
    const messages = body.messages as Array<{ role: string; content?: string }>;
    const toolMessage = messages.find((message) => message.role === 'tool');
    const toolResult = toolMessage ? (toolMessage.content ?? '') : null;
    response.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    if (toolResult === null) {
      response.write(line({ thinking: 'The notes file does not exist yet; ' }));
      response.write(line({ thinking: 'write it, then report.' }));
      response.write(
        line({
          tool_calls: [{ function: { name: 'write_file', arguments: { path: 'notes.md', content: '# Findings' } } }],
        }),
      );
    } else {
      response.write(line({ content: `Result: ${toolResult}. ` }));
      response.write(line({ content: 'Done.' }));
    }
    response.end(line({}, true));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return { server, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

/** The local Ollama surface's default route, compiled from the shipped manifests. */
const OLLAMA_ROUTE = compileProviderCatalog(
  loadProviderCatalogManifestInput(resolve(__dirname, '../../../shared/provider-catalog/manifests')),
)
  .surfaces.get('ollama')!
  .surface.routes.find((candidate) => candidate.default)!;

function ollamaPlan(baseUrl: string) {
  const route = OLLAMA_ROUTE;
  return createTestRequestPlan({
    providerId: 'ollama',
    adapterId: 'ollama-openai-compatible',
    catalogRevision: 'wire-integration',
    routeRevision: 'ollama',
    selectedModelId: MODEL.id,
    effectiveModelId: MODEL.id,
    appliedBindingIds: [],
    route: { protocol: route.protocol, baseUrl, source: 'catalog', contracts: route.contracts },
    headers: {},
    bodyPatch: {},
    contextBudgetTokens: MODEL.contextWindow,
    contextMode: 'normal',
    contextWindowTokens: MODEL.contextWindow,
    activeTierId: 'default',
    fastMode: false,
    reasoningWire: {
      selection: 'on',
      control: {
        kind: 'toggle',
        supportsOff: true,
        levels: [],
        defaultState: 'known',
        defaultSelection: 'on',
        wireProfile: { kind: 'none' },
      },
    },
  });
}

describe('one turn across the wire, loop, approval and final answer', () => {
  let server: Server | null = null;
  beforeEach(() => {
    server = null;
  });
  afterEach(async () => {
    if (server) await new Promise((done) => server!.close(done));
  });

  it.each([true, false])('runs thinking → approved=%s write → replayed result → final answer', async (approved) => {
    const requests: WireRequest[] = [];
    const wire = await startWire(requests);
    server = wire.server;
    const plan = ollamaPlan(wire.baseUrl);
    const approvals = new AgentToolApprovalRequestService();
    const order: string[] = [];
    const effects: string[] = [];

    const executor: ToolExecutor = {
      execute: async (call): Promise<ToolResultMessage> => {
        const granted = await approvals.request({
          agentId: 'general',
          sessionId: 'session-wire',
          turnId: 'turn-wire',
          toolCallId: call.id,
          toolName: call.name,
          argumentsSha256: 'fixture',
          reason: 'Writes a project file.',
          risk: 'medium',
          context: { turnId: 'turn-wire', sessionId: 'session-wire' },
          onEvent: (event) => {
            order.push(event.type);
            if (event.type !== 'approval.requested') return;
            const { approvalId } = event.payload;
            queueMicrotask(() =>
              expect(
                approvals.answer({ sessionId: 'session-wire', turnId: 'turn-wire', approvalId, approved }),
              ).toEqual({ success: true }),
            );
          },
        });
        if (granted) effects.push(`${String(call.arguments.path)}:${String(call.arguments.content)}`);
        const text = granted ? 'wrote notes.md' : 'denied by the user';
        return {
          role: 'toolResult',
          toolCallId: call.id,
          toolName: call.name,
          content: [{ type: 'text', text }],
          isError: !granted,
          timestamp: Date.now(),
        };
      },
    };

    const { stream } = agentLoop(
      [{ role: 'user', content: 'Record the findings.', timestamp: 1 }],
      {
        systemPrompt: 'Investigate and record findings.',
        messages: [],
        tools: [WRITE_TOOL],
      },
      {
        model: MODEL,
        maxTurns: 3,
        convertToLlm: (messages) => messages as Message[],
        streamOptions: { requestPlan: plan, reasoning: plan.reasoningWire },
      },
      new OllamaProvider({ baseUrl: wire.baseUrl }),
      executor,
    );

    let final: AssistantMessage | undefined;
    for await (const event of stream as AsyncIterable<AgentLoopEvent>) {
      if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'thinking_delta')
        order.push('thinking');
      if (event.type === 'tool_execution_end') order.push('tool_result');
      if (event.type === 'message_end' && event.message.role === 'assistant') final = event.message as AssistantMessage;
    }

    expect(requests).toHaveLength(2);
    expect(requests.every(({ body }) => body.think === true && (body.tools as unknown[]).length === 1)).toBe(true);
    const replay = requests[1].body.messages as Array<{ role: string; content?: string; tool_calls?: unknown[] }>;
    expect(replay.some((message) => message.role === 'assistant' && message.tool_calls?.length === 1)).toBe(true);
    expect(replay.find((message) => message.role === 'tool')).toMatchObject({
      content: approved ? 'wrote notes.md' : 'denied by the user',
    });

    expect(order.indexOf('thinking')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('thinking')).toBeLessThan(order.indexOf('approval.requested'));
    expect(order.indexOf('approval.requested')).toBeLessThan(order.indexOf('approval.answered'));
    expect(order.indexOf('approval.answered')).toBeLessThan(order.indexOf('tool_result'));
    expect(effects).toEqual(approved ? ['notes.md:# Findings'] : []);

    expect(final?.stopReason).toBe('stop');
    const answer = final!.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');
    expect(answer).toBe(`Result: ${approved ? 'wrote notes.md' : 'denied by the user'}. Done.`);
  });
});
