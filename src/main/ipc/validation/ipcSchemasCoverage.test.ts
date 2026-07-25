import { describe, expect, it } from 'vitest';
import { parseIpcArgs } from './IpcPayloadGuard';
import { AgentConfigureArgsSchema, AgentGetStateArgsSchema, AgentSendMessageArgsSchema } from './agentSchemas';
import { AppCopyTextArgsSchema, AppGetAvatarDataUrlArgsSchema, AppOpenPathArgsSchema } from './shellSchemas';
import {
  LlmModelCapabilityProbeArgsSchema,
  LlmProviderDraftArgsSchema,
  LlmProviderIdArgsSchema,
} from './settingsLlmSchemas';
import { EvidenceGetEventsArgsSchema } from './toolEvidenceSchemas';

describe('IPC schema coverage', () => {
  it('accepts and rejects agent channel args', () => {
    expect(parseIpcArgs(AgentSendMessageArgsSchema, ['ask', 'hello'])).toEqual(['ask', 'hello']);
    expect(() => parseIpcArgs(AgentSendMessageArgsSchema, ['', 'hello'])).toThrow();
    expect(parseIpcArgs(AgentGetStateArgsSchema, ['ask'])).toEqual(['ask']);
    expect(parseIpcArgs(AgentConfigureArgsSchema, ['ask', { temperature: 0.2 }])).toEqual([
      'ask',
      { temperature: 0.2 },
    ]);
    const tooManyKeys = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`k${i}`, i]));
    expect(() => parseIpcArgs(AgentConfigureArgsSchema, ['ask', tooManyKeys])).toThrow();
  });

  it('accepts shell/app channel args', () => {
    expect(parseIpcArgs(AppGetAvatarDataUrlArgsSchema, ['D:/a.png'])[0]).toBe('D:/a.png');
    expect(parseIpcArgs(AppOpenPathArgsSchema, ['D:/file.txt'])[0]).toBe('D:/file.txt');
    expect(parseIpcArgs(AppCopyTextArgsSchema, ['copied'])[0]).toBe('copied');
    expect(() => parseIpcArgs(AppCopyTextArgsSchema, ['x'.repeat(2_000_001)])).toThrow();
  });

  it('accepts settings/llm channel args', () => {
    expect(parseIpcArgs(LlmProviderIdArgsSchema, ['openai'])[0]).toBe('openai');
    expect(parseIpcArgs(LlmProviderDraftArgsSchema, [{
      providerId: 'openai',
      authMode: 'api-key',
      apiKey: 'sk-test',
    }])[0]).toMatchObject({ providerId: 'openai' });
    expect(parseIpcArgs(LlmModelCapabilityProbeArgsSchema, [{
      providerId: 'openai',
      modelId: 'gpt',
      mode: 'default',
    }])[0].mode).toBe('default');
    expect(() => parseIpcArgs(LlmModelCapabilityProbeArgsSchema, [{
      providerId: 'openai',
      modelId: 'gpt',
      mode: 'nope',
    }])).toThrow();
  });

  it('accepts optional evidence filter', () => {
    expect(parseIpcArgs(EvidenceGetEventsArgsSchema, [])).toEqual([]);
    expect(parseIpcArgs(EvidenceGetEventsArgsSchema, ['tool.completed'])[0]).toBe('tool.completed');
  });
});
