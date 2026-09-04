import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createProfileTestResponse,
  createTestModeStub,
  streamTestModeStub,
} from './OrchestratorTestStubs';

describe('OrchestratorTestStubs', () => {
  const prev = process.env.RDC_AGENT_TEST_MODE;

  beforeEach(() => {
    process.env.RDC_AGENT_TEST_MODE = '1';
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.RDC_AGENT_TEST_MODE;
    else process.env.RDC_AGENT_TEST_MODE = prev;
  });

  it('streamTestModeStub emits chunks then returns full text', async () => {
    const chunks: string[] = [];
    const text = await streamTestModeStub('abcdef', {
      onChunk: (chunk) => {
        chunks.push(chunk);
      },
    });
    expect(text).toBe('abcdef');
    expect(chunks.join('')).toBe('abcdef');
    expect(chunks.length).toBe(2);
  });

  it('createTestModeStub returns null when test mode is off', () => {
    delete process.env.RDC_AGENT_TEST_MODE;
    expect(createTestModeStub('custom-readonly', 'hello', 'Custom readonly')).toBeNull();
  });

  it('createTestModeStub picks greeting / unreal / start variants', () => {
    expect(createTestModeStub('custom-readonly', 'hello there', 'Custom readonly')).toMatch(/Hello/);
    expect(createTestModeStub('debugger', 'hi', 'Debugger')).toMatch(/Hello/);
    expect(createTestModeStub('custom-readonly', 'UE4 materials', 'Custom readonly')).toMatch(/Unreal Engine 4/);
    expect(createTestModeStub('custom-readonly', 'please start debugging', 'Custom readonly')).toMatch(/Received/);
    expect(createTestModeStub('custom-readonly', 'plain question', 'Custom readonly')).toMatch(/Custom readonly is ready/);
    expect(createTestModeStub('debugger', 'plain', 'Debugger')).toMatch(/Debugger is ready/);
  });

  it('createTestModeStub reads JSON envelope user messages', () => {
    const stub = createTestModeStub(
      'custom-readonly',
      JSON.stringify({ effective_user_message: 'hello' }),
      'Custom readonly',
    );
    expect(stub).toMatch(/Hello/);
  });

  it('createTestModeStub forces LLM failure marker', () => {
    expect(() => createTestModeStub('custom-readonly', '__RDC_AGENT_E2E_FORCE_LLM_FAILURE__', 'Custom readonly'))
      .toThrow(/E2E forced profile LLM/);
  });

  it('createProfileTestResponse streams and handles custom-readonly tool markers', async () => {
    const events: Array<{ type: string }> = [];
    const chunks: string[] = [];
    const text = await createProfileTestResponse('custom-readonly', '__RDC_AGENT_E2E_READONLY_TOOL__', {
      onChunk: (chunk) => chunks.push(chunk),
      onEvent: (event) => events.push({ type: event.type }),
      turnId: 'turn-1',
      sessionId: 'sess-1',
    });
    expect(text).toMatch(/grep/);
    expect(chunks.join('')).toBe(text);
    expect(events.map((e) => e.type)).toEqual(['tool.started', 'tool.completed']);
  });

  it('createProfileTestResponse emits deny-write tool events', async () => {
    const events: Array<{ type: string }> = [];
    const text = await createProfileTestResponse('custom-readonly', '__RDC_AGENT_E2E_DENY_WRITE__', {
      onEvent: (event) => events.push({ type: event.type }),
    });
    expect(text).toMatch(/cannot write/i);
    expect(events.map((e) => e.type)).toEqual(['tool.started', 'tool.denied']);
  });

  it('createProfileTestResponse covers non-readonly default and force-failure', async () => {
    await expect(createProfileTestResponse('debugger', '__RDC_AGENT_E2E_FORCE_LLM_FAILURE__'))
      .rejects.toThrow(/E2E forced/);
    const greeting = await createProfileTestResponse('debugger', '你好');
    expect(greeting).toMatch(/Hello/);
    const unreal = await createProfileTestResponse('custom-readonly', 'unreal engine');
    expect(unreal).toMatch(/UE4|Unreal/i);
    const start = await createProfileTestResponse('custom-readonly', 'please start debugging now');
    expect(start).toMatch(/Received/);
    const plain = await createProfileTestResponse('debugger', 'scope the target');
    expect(plain).toMatch(/configured tools|scope|execute/i);
  });
});
