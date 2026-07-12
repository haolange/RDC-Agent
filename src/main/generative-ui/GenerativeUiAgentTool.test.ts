import { describe, expect, it } from 'vitest';
import { createGenerativeUiAgentTool } from './GenerativeUiAgentTool';

const context = { workspaceRoot: 'D:/repo', projectRootPath: 'D:/repo', projectId: 'project', sessionId: 'session' };

describe('GenerativeUiAgentTool', () => {
  it('fails closed without an active session', async () => {
    const result = await createGenerativeUiAgentTool().execute('call', { action: 'inspect' }, undefined, undefined, { ...context, sessionId: null });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: 'text', text: 'Generative UI requires an active session.' });
  });

  it('runs a deterministic bounded simulation', async () => {
    const tool = createGenerativeUiAgentTool();
    const args = { action: 'simulate' as const, simulation: { steps: 3, initialValue: 10, rate: 0.1, noise: 0.2, seed: 7 } };
    const first = await tool.execute('one', args, undefined, undefined, context);
    const second = await tool.execute('two', args, undefined, undefined, context);
    expect(first.details).toEqual(second.details);
    expect((first.details as { series: unknown[] }).series).toHaveLength(3);
  });

  it('caps simulation output', async () => {
    const result = await createGenerativeUiAgentTool().execute('call', { action: 'simulate', simulation: { steps: 50_000 } }, undefined, undefined, context);
    expect((result.details as { series: unknown[] }).series).toHaveLength(500);
  });

  it('rejects non-image and oversized asset inputs before generation', async () => {
    const result = await createGenerativeUiAgentTool().execute('call', { action: 'generate', prompt: 'UI', assets: [{ name: 'script', source: 'test', dataUrl: 'data:text/html;base64,AAAA' }] }, undefined, undefined, context);
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: 'text', text: 'assets must be base64 image data URLs.' });
  });
});
