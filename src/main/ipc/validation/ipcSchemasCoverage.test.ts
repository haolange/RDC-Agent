import { readdirSync, readFileSync } from 'fs';
import path from 'path';
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
import { InvestigationReadArgsSchema } from './investigationSchemas';

const HANDLERS_DIR = path.join(__dirname, '..');
const HANDLER_FILES = readdirSync(HANDLERS_DIR)
  .filter((name) => name.endsWith('Handlers.ts') && !name.includes('.test.'))
  .sort();

describe('IPC schema coverage', () => {
  it('enumerates every IPC handler module and requires parseIpcArgs wiring', () => {
    expect(HANDLER_FILES.length).toBeGreaterThan(10);
    const compositionRoots = new Set(['workbenchHandlers.ts', 'handlers.ts']);
    for (const file of HANDLER_FILES) {
      const source = readFileSync(path.join(HANDLERS_DIR, file), 'utf8');
      if (compositionRoots.has(file)) {
        continue;
      }
      expect(source.includes('parseIpcArgs'), `${file} must validate via parseIpcArgs`).toBe(true);
      // Channels must go through ipcMain.handle + parseIpcArgs (not unvalidated listeners).
      expect(source.includes('ipcMain.handle'), `${file} should register via ipcMain.handle`).toBe(true);
    }
  });

  it('accepts and rejects agent channel args', () => {
    expect(parseIpcArgs(AgentSendMessageArgsSchema, ['ask', 'hello'])).toEqual(['ask', 'hello']);
    expect(() => parseIpcArgs(AgentSendMessageArgsSchema, ['', 'hello'])).toThrow();
    expect(parseIpcArgs(AgentGetStateArgsSchema, ['ask'])).toEqual(['ask']);
    expect(parseIpcArgs(AgentGetStateArgsSchema, ['ask', 'session-1'])).toEqual(['ask', 'session-1']);
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

  it('accepts investigation:read ids and rejects URI or path payloads', () => {
    const hash = `sha256:${'a'.repeat(64)}`;
    expect(parseIpcArgs(InvestigationReadArgsSchema, [{
      sessionId: 'session-1',
      artifactId: 'invart-1',
      expectedHash: hash,
    }])).toEqual([{ sessionId: 'session-1', artifactId: 'invart-1', expectedHash: hash }]);
    expect(() => parseIpcArgs(InvestigationReadArgsSchema, [{
      sessionId: 'session-1',
      artifactId: 'session://investigation/a.json',
      expectedHash: hash,
    }])).toThrow();
    expect(() => parseIpcArgs(InvestigationReadArgsSchema, [{
      sessionId: 'session-1',
      artifactId: 'invart-1',
      expectedHash: hash,
      uri: 'D:/escape.json',
    }])).toThrow();
    for (const schemeId of ['file:record', 'http:record', 'D:record']) {
      expect(() => parseIpcArgs(InvestigationReadArgsSchema, [{
        sessionId: 'session-1',
        artifactId: schemeId,
        expectedHash: hash,
      }])).toThrow();
      expect(() => parseIpcArgs(InvestigationReadArgsSchema, [{
        sessionId: schemeId,
        artifactId: 'invart-1',
        expectedHash: hash,
      }])).toThrow();
    }
  });

  it('accepts optional evidence filter', () => {
    expect(parseIpcArgs(EvidenceGetEventsArgsSchema, [])).toEqual([]);
    expect(parseIpcArgs(EvidenceGetEventsArgsSchema, ['tool.completed'])[0]).toBe('tool.completed');
  });
});
