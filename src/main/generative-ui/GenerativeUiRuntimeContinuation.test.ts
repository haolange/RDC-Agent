import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }));
import { GenerativeUiCanvasService } from './GenerativeUiCanvasService';
import { GenerativeUiRuntimeContinuation } from './GenerativeUiRuntimeContinuation';

const roots: string[] = [];
const source = { html: '<main>Ready</main>', css: 'main{display:grid}', javascript: '' };
const spec = { title: 'UI', intent: 'Test', layout: 'grid', components: [], interactions: [], dataBindings: [], visualStyle: 'clear', responsiveRequirements: [] };
const setup = (reflect: (call: number) => { reflection: string; shouldContinue: boolean }, onPlan?: (previous: unknown) => void) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-runtime-loop-'));
  roots.push(root);
  const canvases = new GenerativeUiCanvasService(root);
  let reflectionCalls = 0;
  const model = {
    plan: async (_prompt: string, previous?: unknown) => { onPlan?.(previous); return { spec }; }, generate: async () => ({ source }),
    reflect: async () => reflect(++reflectionCalls),
  };
  return { canvases, continuation: new GenerativeUiRuntimeContinuation(canvases, model) };
};
const version = (canvases: GenerativeUiCanvasService) => {
  const canvas = canvases.create('project', 'session', 'UI', 'Build UI');
  return canvases.commit('session', { canvasId: canvas.canvasId, branchId: canvas.activeBranchId, parentVersionId: null, prompt: 'Build UI', spec, source,
    runtimePolicy: 'automatic', verification: [{ level: 1, passed: true, checks: [], observedAt: Date.now() }, { level: 2, passed: true, checks: [], observedAt: Date.now() }],
    metrics: { planningMs: 1, generationMs: 1, renderMs: 1, verificationMs: 1 } });
};
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

describe('GenerativeUiRuntimeContinuation', () => {
  it('reflects on L3 evidence and closes an automatic loop', async () => {
    const { canvases, continuation } = setup(() => ({ reflection: 'Runtime goal achieved.', shouldContinue: false }));
    const canvas = version(canvases);
    const result = await continuation.observe('session', canvas.canvasId, canvas.versions[0].versionId, 'ready');
    expect(result.stopReason).toBe('success');
    expect(result.versions[0]).toMatchObject({ runtimeDecision: 'success', runtimeReflection: 'Runtime goal achieved.' });
  });

  it('creates the next persisted version when runtime reflection requests repair', async () => {
    let plannerContext: unknown;
    const { canvases, continuation } = setup((call) => call === 1
      ? { reflection: 'Runtime repair required.', shouldContinue: true }
      : { reflection: 'Static checks pass.', shouldContinue: false }, (previous) => { plannerContext = previous; });
    const canvas = version(canvases);
    const result = await continuation.observe('session', canvas.canvasId, canvas.versions[0].versionId, 'runtime_error', { message: 'boom' });
    expect(result.versions).toHaveLength(2);
    expect(result.versions[0].runtimeDecision).toBe('continue');
    expect(result.versions[1].runtimeDecision).toBe('pending');
    expect(result.stopReason).toBeNull();
    expect(plannerContext).toMatchObject({ reflection: 'Runtime repair required.' });
  });

  it('waits for real interaction evidence when the Spec requires it', async () => {
    const { canvases, continuation } = setup(() => ({ reflection: 'Interaction achieved.', shouldContinue: false }));
    const canvas = canvases.create('project', 'session', 'Interactive', 'Build interactive UI');
    const committed = canvases.commit('session', { canvasId: canvas.canvasId, branchId: canvas.activeBranchId, parentVersionId: null, prompt: 'Build interactive UI',
      spec: { ...spec, interactions: [{ trigger: 'input', effect: 'update output' }] }, source, runtimePolicy: 'automatic',
      verification: [{ level: 1, passed: true, checks: [], observedAt: Date.now() }, { level: 2, passed: true, checks: [], observedAt: Date.now() }],
      metrics: { planningMs: 1, generationMs: 1, renderMs: 1, verificationMs: 1 } });
    const versionId = committed.versions[0].versionId;
    const ready = await continuation.observe('session', canvas.canvasId, versionId, 'ready');
    expect(ready.versions[0].runtimeDecision).toBe('pending');
    const interacted = await continuation.observe('session', canvas.canvasId, versionId, 'interaction', { interactionType: 'input', message: 'INPUT#field' });
    expect(interacted.stopReason).toBe('success');
  });
});
