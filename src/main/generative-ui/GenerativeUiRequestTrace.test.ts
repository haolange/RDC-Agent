import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LLMRequest, LLMResponse } from '@shared/types/llm';

vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }));
import { RequestSnapshotStore } from '../agent-runtime/prompt/RequestSnapshotStore';
import { GenerativeUiRequestTrace } from './GenerativeUiRequestTrace';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

describe('GenerativeUiRequestTrace', () => {
  it('persists and completes a PromptPlan-backed request envelope', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-generative-trace-'));
    roots.push(root);
    const store = new RequestSnapshotStore(root);
    const trace = new GenerativeUiRequestTrace(store);
    const context = { sessionId: 'session-1', turnId: 'generative-ui:canvas:main', phase: 'generate' as const };
    const request: LLMRequest = { model: 'model', responseFormat: 'json_object', messages: [
      { role: 'system', content: 'System contract' }, { role: 'user', content: [
        { type: 'text', text: 'Build UI' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'private-image-bytes' } },
      ] },
    ] };
    const id = trace.begin('System contract', request, { providerId: 'provider', modelId: 'model', protocol: 'OpenAIResponses' }, context);
    trace.complete(id, { id: 'response', model: 'model', content: '{}', usage: { inputTokens: 8, outputTokens: 3 }, stopReason: 'end_turn' } as LLMResponse, context);
    const snapshots = store.list(context.sessionId, context.turnId);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({ id, completedAt: expect.any(String), callIndex: 1,
      route: { providerId: 'provider', modelId: 'model', protocol: 'OpenAIResponses' },
      promptPlan: { systemPrompt: 'System contract', segments: [{ sourcePath: 'runtime://generative-ui/system' }] },
      controls: { phase: 'generate', responseFormat: 'json_object' }, usage: { inputTokens: 8, outputTokens: 3, estimated: false } });
    expect(JSON.stringify(snapshots[0])).not.toContain('private-image-bytes');
    expect(snapshots[0].redactions).toEqual([expect.objectContaining({ reason: 'binary image payload', hash: expect.any(String) })]);
  });
});
