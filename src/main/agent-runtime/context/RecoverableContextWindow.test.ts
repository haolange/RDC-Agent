import { describe, expect, it, vi } from 'vitest';
import type { AgentMessage, AssistantMessage, UserMessage } from '../core/types';
import { RecoverableContextWindow } from './RecoverableContextWindow';

const user = (content: string): UserMessage => ({ role: 'user', content, timestamp: 1 });
const assistant = (text: string): AssistantMessage => ({ role: 'assistant', content: [{ type: 'text', text }], model: 'fixture', provider: 'fixture', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, timestamp: 2, stopReason: 'stop' });
const history = (): AgentMessage[] => [user('Preserve normal highlights; unknown cause'), ...Array.from({ length: 12 }, (_, i) => assistant(`${i}: ${'evidence '.repeat(30)}`)), user('only the tear duct'), assistant('next')];
const estimate = (messages: AgentMessage[]) => JSON.stringify(messages.map(message => 'content' in message ? message.content : message)).length;
function setup() {
  const saved: AgentMessage[][] = [];
  const save = vi.fn(async (messages: AgentMessage[]) => { saved.push(structuredClone(messages)); return { uri: 'session://tool-outputs/source.json', hash: 'hash', context: '{}' }; });
  const generate = vi.fn(async () => ({ ...user('Qualified conclusion; original source available'), derivedContext: { viewId: 'view', handoffId: 'handoff', sourceHash: 'hash' } }));
  const verify = vi.fn(async () => {});
  const installed = vi.fn(async () => {});
  return { saved, save, generate, verify, installed, window: new RecoverableContextWindow({ tokenLimit: 1500, estimate, save, generate, verify, installed }) };
}
describe('recoverable model window', () => {
  it('saves original middle evidence before generation and retains canonical history', async () => {
    const s = setup(); const messages = history(); const original = structuredClone(messages);
    await s.window.prepare(messages);
    expect(s.saved[0]).toContainEqual(messages[6]);
    expect(s.save.mock.invocationCallOrder[0]).toBeLessThan(s.generate.mock.invocationCallOrder[0]);
    expect(s.verify.mock.invocationCallOrder[0]).toBeLessThan(s.installed.mock.invocationCallOrder[0]);
    expect(messages).toEqual(original);
  });
  it('reuses a verified window without repeating a model call', async () => {
    const s = setup(); const messages = history(); const first = await s.window.prepare(messages);
    const next = await s.window.prepare([...messages, assistant('new progress')]);
    expect(s.generate).toHaveBeenCalledTimes(1);
    expect(next.messages).toEqual([...first.messages, assistant('new progress')]);
    expect(next.summary).toBeUndefined();
  });
  it('pins the initial user requirement throughout an uninterrupted long tool run', async () => {
    const s = setup(); const messages = history().slice(0, -2);
    const first = await s.window.prepare(messages);
    const second = await s.window.prepare([...messages, assistant('next')]);
    expect(first.messages).toContainEqual(messages[0]); expect(second.messages).toContainEqual(messages[0]);
  });
  it('recompacts from original evidence, never a summary of the previous summary', async () => {
    const s = setup(); const messages = history(); await s.window.prepare(messages);
    await s.window.prepare([...messages, ...history().slice(1)]);
    expect(s.generate).toHaveBeenCalledTimes(2);
    expect(s.saved[1]).toContainEqual(messages[6]);
    expect(s.saved[1].some(message => message.role === 'user' && message.derivedContext)).toBe(false);
  });
  it('invalidates a cached prefix when a user correction replaces old input', async () => {
    const s = setup(); const messages = history(); await s.window.prepare(messages);
    messages[0] = user('Correction: do not change iris shading'); await s.window.prepare(messages);
    expect(s.saved[1][0]).toEqual(messages[0]); expect(s.generate).toHaveBeenCalledTimes(2);
  });
  it('archives old image blocks and paired tool evidence without mutating them', async () => {
    const s = setup(); const messages = history();
    messages[3] = { ...assistant('inspect'), content: [{ type: 'toolCall', id: 'image', name: 'artifact_read', arguments: {} }] };
    messages[4] = { role: 'toolResult', toolCallId: 'image', toolName: 'artifact_read', content: [{ type: 'image', mimeType: 'image/png', data: 'original-image' }], isError: false, timestamp: 4 };
    await s.window.prepare(messages);
    expect(s.saved[0][3]).toEqual(messages[3]); expect(s.saved[0][4]).toEqual(messages[4]);
  });
  it('does not install on source verification failure or repeatedly call a model for unchanged input', async () => {
    const s = setup(); s.verify.mockRejectedValue(new Error('source changed'));
    await expect(s.window.prepare(history())).rejects.toThrow('source changed');
    await expect(s.window.prepare(history())).rejects.toThrow('unchanged source');
    expect(s.installed).not.toHaveBeenCalled(); expect(s.generate).toHaveBeenCalledTimes(1);
  });
  it('does not invoke generation after failed source persistence', async () => {
    const s = setup(); s.save.mockRejectedValue(new Error('disk full'));
    await expect(s.window.prepare(history())).rejects.toThrow('disk full'); expect(s.generate).not.toHaveBeenCalled();
  });
  it('cancels before installation when cancellation arrives during generation', async () => {
    const s = setup(); const abort = new AbortController();
    s.generate.mockImplementation(async () => { abort.abort(); return { ...user('discard'), derivedContext: { viewId: 'v', handoffId: 'h', sourceHash: 's' } }; });
    await expect(s.window.prepare(history(), abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(s.installed).not.toHaveBeenCalled();
  });
  it('externalizes an oversized first input intact before installing its explicit read reference', async () => {
    const s = setup(); const input = [user('middle constraint '.repeat(1000))];
    const result = await s.window.prepare(input);
    expect(s.saved[0]).toEqual(input); expect(s.generate).not.toHaveBeenCalled();
    expect(JSON.stringify(result.messages)).toContain('Read the original input through artifact_read before');
    expect(s.verify.mock.invocationCallOrder[0]).toBeLessThan(s.installed.mock.invocationCallOrder[0]);
    expect(input[0].content).toBe('middle constraint '.repeat(1000));
  });
});

it('drops pre-checkpoint provider response IDs but retains fresh post-checkpoint continuation', async () => {
  const s = setup(); const messages = history();
  const retained = { ...assistant('old provider response'), providerState: { value: 'old-response' } as never };
  messages[messages.length - 1] = retained;
  const first = await s.window.prepare(messages);
  expect(first.messages.some(value => value.role === 'assistant' && value.providerState)).toBe(false);
  expect(retained.providerState).toEqual({ value: 'old-response' });
  const fresh = { ...assistant('new provider response'), providerState: { value: 'new-response' } as never };
  const second = await s.window.prepare([...messages, fresh]);
  expect(second.messages.filter(value => value.role === 'assistant' && value.providerState)).toEqual([fresh]);
  expect(s.generate).toHaveBeenCalledTimes(1);
});

it('does not announce installation when cancellation arrives during durable candidate persistence', async () => {
  const s = setup(); const abort = new AbortController(); const afterInstall = vi.fn();
  s.installed.mockImplementation(async () => { abort.abort(); });
  const window = new RecoverableContextWindow({ tokenLimit: 1500, estimate, save: s.save, generate: s.generate, verify: s.verify, installed: s.installed, afterInstall });
  await expect(window.prepare(history(), abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(afterInstall).not.toHaveBeenCalled();
});
