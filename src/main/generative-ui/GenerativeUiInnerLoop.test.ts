import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GenerativeUiCanvasService } from './GenerativeUiCanvasService';
import { GenerativeUiInnerLoop } from './GenerativeUiInnerLoop';

vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }));

const roots: string[] = [];
const service = (): GenerativeUiCanvasService => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-inner-loop-'));
  roots.push(root);
  return new GenerativeUiCanvasService(root);
};

afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

const planner = {
  plan: async () => ({
    spec: {
      title: 'Counter', intent: 'Count clicks', layout: 'responsive grid',
      components: [{ id: 'counter', kind: 'button', purpose: 'Increment' }],
      interactions: [{ trigger: 'click', effect: 'increment counter' }],
      dataBindings: [{ source: 'count', target: 'counter' }],
      visualStyle: 'minimal', responsiveRequirements: ['mobile'],
    },
    usage: { inputTokens: 10, outputTokens: 20, estimatedCostUsd: 0.01 },
  }),
};

describe('GenerativeUiInnerLoop', () => {
  it('degrades to no-op when the planner rejects interactive UI generation', async () => {
    const canvases = service();
    const loop = new GenerativeUiInnerLoop(
      { plan: async () => ({ ...(await planner.plan()), noOpReason: 'A plain factual answer is more appropriate.' }) },
      { generate: async () => { throw new Error('must not generate'); } },
      { reflect: async () => { throw new Error('must not reflect'); } },
      canvases,
    );
    const result = await loop.run({
      projectId: 'p1', sessionId: 's1', prompt: 'What time is it?', checkpoint: 'automatic',
      budget: { maxIterations: 3, maxTotalMs: 5_000 },
    });
    expect(result.stopReason).toBe('no_op');
    expect(result.canvas.versions).toHaveLength(0);
    expect(result.fallback?.kind).toBe('static');
  });

  it('closes the full loop and persists a verified version', async () => {
    const canvases = service();
    const loop = new GenerativeUiInnerLoop(
      planner,
      { generate: async () => ({ source: {
        html: '<main id="counter"><button id="counter-button">0</button></main>',
        css: 'main{display:grid} @media(max-width:600px){main{display:flex}}',
        javascript: 'let count = 0; document.querySelector("button")?.addEventListener("click", () => { count += 1; })',
      } }) },
      { reflect: async () => ({ reflection: 'All checks pass.', shouldContinue: false }) },
      canvases,
    );
    const result = await loop.run({
      projectId: 'p1', sessionId: 's1', prompt: 'Build a counter', checkpoint: 'automatic',
      budget: { maxIterations: 3, maxTotalMs: 5_000 },
    });
    expect(result.stopReason).toBe('success');
    expect(result.iterations).toBe(1);
    expect(result.version?.verification.map((entry) => entry.passed)).toEqual([true, true]);
    expect(result.awaitingCheckpoint).toBe(true);
    expect(canvases.list('s1')[0].stopReason).toBeNull();
  });

  it('iterates until exhausted when verification cannot pass', async () => {
    const canvases = service();
    const loop = new GenerativeUiInnerLoop(
      planner,
      { generate: async () => ({ source: { html: '', css: 'width: 2000px', javascript: 'fetch("https://example.com")' } }) },
      { reflect: async () => ({ reflection: 'Repair required.', shouldContinue: true }) },
      canvases,
    );
    const result = await loop.run({
      projectId: 'p1', sessionId: 's1', prompt: 'Build a counter', checkpoint: 'automatic',
      budget: { maxIterations: 2, maxTotalMs: 5_000 },
    });
    expect(result.stopReason).toBe('exhausted');
    expect(result.iterations).toBe(2);
    expect(result.canvas.versions).toHaveLength(2);
    expect(result.diagnostics[0]).toContain('html-present');
    expect(result.fallback?.kind).toBe('human');
  });

  it('blocks after repeated iterations make no source progress', async () => {
    const canvases = service();
    const loop = new GenerativeUiInnerLoop(
      planner,
      { generate: async () => ({ source: { html: '', css: '', javascript: '' } }) },
      { reflect: async () => ({ reflection: 'Try again.', shouldContinue: true }) },
      canvases,
    );
    const result = await loop.run({
      projectId: 'p1', sessionId: 's1', prompt: 'Build it', checkpoint: 'automatic',
      budget: { maxIterations: 8, maxTotalMs: 5_000, maxStagnantIterations: 2 },
    });
    expect(result.stopReason).toBe('blocked');
    expect(result.iterations).toBe(3);
    expect(result.fallback?.kind).toBe('human');
  });

  it('pauses at a human checkpoint with the generated version persisted', async () => {
    const canvases = service();
    const loop = new GenerativeUiInnerLoop(
      planner,
      { generate: async () => ({ source: {
        html: '<button id="counter">0</button>', css: 'button{display:grid}',
        javascript: 'document.querySelector("button")?.addEventListener("click", () => {})',
      } }) },
      { reflect: async () => ({ reflection: 'Await review.', shouldContinue: false }) },
      canvases,
    );
    const result = await loop.run({
      projectId: 'p1', sessionId: 's1', prompt: 'Build a counter', checkpoint: 'after_verification',
      budget: { maxIterations: 5, maxTotalMs: 5_000 },
    });
    expect(result.awaitingCheckpoint).toBe(true);
    expect(result.canvas.versions).toHaveLength(1);
  });

  it('converts provider failures into a persisted blocked state', async () => {
    const canvases = service();
    const loop = new GenerativeUiInnerLoop(
      { plan: async () => { throw new Error('provider unavailable'); } },
      { generate: async () => { throw new Error('not reached'); } },
      { reflect: async () => { throw new Error('not reached'); } },
      canvases,
    );
    const result = await loop.run({ projectId: 'p1', sessionId: 's1', prompt: 'Build UI', checkpoint: 'automatic', budget: { maxIterations: 2, maxTotalMs: 5_000 } });
    expect(result.stopReason).toBe('blocked');
    expect(result.canvas.stopReason).toBe('blocked');
    expect(result.fallback).toMatchObject({ kind: 'human', message: expect.stringContaining('provider unavailable') });
  });

  it('uses contextual payload for generation but persists only prompt provenance', async () => {
    const canvases = service();
    const plan = vi.fn(planner.plan);
    const generate = vi.fn(async () => ({ source: {
      html: '<button id="counter">0</button>', css: 'button{display:grid}',
      javascript: 'document.querySelector("button")?.addEventListener("click", () => {})',
    } }));
    const loop = new GenerativeUiInnerLoop(
      { plan }, { generate },
      { reflect: async () => ({ reflection: 'Ready.', shouldContinue: false }) }, canvases,
    );
    const contextReferences = [{
      kind: 'data' as const, name: 'dataContext', source: 'web:official-source', scope: 'session' as const,
      hash: 'sha256:abc', precedence: 'supplemental' as const, redaction: 'caller_redacted' as const,
    }];
    const result = await loop.run({
      projectId: 'p1', sessionId: 's1', prompt: 'Build a counter',
      modelPrompt: 'Build a counter\n\nprivate contextual payload', contextReferences,
      checkpoint: 'automatic', budget: { maxIterations: 1, maxTotalMs: 5_000 },
    });
    expect(plan).toHaveBeenCalledWith(expect.stringContaining('private contextual payload'), undefined,
      expect.objectContaining({ sessionId: 's1', phase: 'plan', turnId: expect.stringContaining('generative-ui:') }));
    expect(generate).toHaveBeenCalledWith(expect.stringContaining('private contextual payload'), expect.anything(), undefined,
      expect.objectContaining({ sessionId: 's1', phase: 'generate', turnId: expect.stringContaining('generative-ui:') }));
    expect(result.version?.prompt).toBe('Build a counter');
    expect(result.version?.contextReferences).toEqual(contextReferences);
    expect(JSON.stringify(result.canvas)).not.toContain('private contextual payload');
  });
});
