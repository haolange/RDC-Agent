import os from 'os';
import { describe, expect, it, vi } from 'vitest';
import type { LLMResponse } from '@shared/types/llm';

vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() }, safeStorage: { isEncryptionAvailable: () => false } }));
import { LlmGenerativeUiModel } from './LlmGenerativeUiModel';
import type { LLMAdapter } from '../settings/LLMAdapter';
import type { SettingsService } from '../settings/SettingsService';
import type { GenerativeUiRequestTrace } from './GenerativeUiRequestTrace';

const response = (content: string): LLMResponse => ({ id: 'response', model: 'model', content, usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'end_turn' });
const model = (content: string) => new LlmGenerativeUiModel(
  { chat: async () => response(content) } as unknown as LLMAdapter,
  { getLlmConfig: () => ({ agentRoutes: [{ agentId: 'edit', providerId: 'openai', modelId: 'model' }], providers: [{ id: 'openai', protocol: 'OpenAIResponses' }] }) } as unknown as SettingsService,
);

describe('LlmGenerativeUiModel structured output', () => {
  it('accepts a complete source response', async () => {
    const result = await model('{"html":"<main>Ready</main>","css":"main{}","javascript":""}').generate('Build UI', {
      title: 'UI', intent: 'Test', layout: 'grid', components: [], interactions: [], dataBindings: [], visualStyle: 'clear', responsiveRequirements: [],
    });
    expect(result.source.html).toContain('Ready');
  });

  it('rejects syntactically valid JSON with a missing source contract', async () => {
    await expect(model('{"html":""}').generate('Build UI', {
      title: 'UI', intent: 'Test', layout: 'grid', components: [], interactions: [], dataBindings: [], visualStyle: 'clear', responsiveRequirements: [],
    })).rejects.toThrow(/invalid structured response/i);
  });

  it('records a request envelope around contextual provider calls', async () => {
    const begin = vi.fn(() => 'snapshot-1');
    const complete = vi.fn();
    const chat = vi.fn(async () => response('{"html":"<main>Ready</main>","css":"","javascript":""}'));
    const traced = new LlmGenerativeUiModel(
      { chat } as unknown as LLMAdapter,
      { getLlmConfig: () => ({ agentRoutes: [{ agentId: 'edit', providerId: 'openai', modelId: 'model' }], providers: [{ id: 'openai', protocol: 'OpenAIResponses' }] }) } as unknown as SettingsService,
      { begin, complete } as unknown as GenerativeUiRequestTrace,
    );
    await traced.generate('Build UI', {
      title: 'UI', intent: 'Test', layout: 'grid', components: [], interactions: [], dataBindings: [], visualStyle: 'clear', responsiveRequirements: [],
    }, undefined, { sessionId: 'session-1', turnId: 'canvas-1', phase: 'generate', images: [{ mediaType: 'image/png', data: 'image-bytes' }] });
    expect(begin).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ responseFormat: 'json_object' }), expect.objectContaining({ protocol: 'OpenAIResponses' }), expect.objectContaining({ phase: 'generate' }));
    expect(complete).toHaveBeenCalledWith('snapshot-1', expect.objectContaining({ id: 'response' }), expect.objectContaining({ sessionId: 'session-1' }));
    expect(chat).toHaveBeenCalledWith(expect.objectContaining({ messages: expect.arrayContaining([
      expect.objectContaining({ role: 'user', content: expect.arrayContaining([expect.objectContaining({ type: 'image', source: expect.objectContaining({ media_type: 'image/png', data: 'image-bytes' }) })]) }),
    ]) }), 'openai');
  });
});
