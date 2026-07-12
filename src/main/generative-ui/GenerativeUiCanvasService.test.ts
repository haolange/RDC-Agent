import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
}));
import { GenerativeUiCanvasService } from './GenerativeUiCanvasService';
import { buildGenerativeUiSandboxDocument, GENERATIVE_UI_IFRAME_SANDBOX } from './GenerativeUiSandbox';

const roots: string[] = [];
const createService = (): GenerativeUiCanvasService => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-canvas-'));
  roots.push(root);
  return new GenerativeUiCanvasService(root);
};

afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

describe('GenerativeUiCanvasService', () => {
  it('persists immutable version history and rejects stale branch commits', () => {
    const service = createService();
    const created = service.create('project-1', 'session-1', 'Dashboard', 'Build a dashboard');
    const branchId = created.activeBranchId;
    const first = service.commit('session-1', {
      canvasId: created.canvasId,
      branchId,
      parentVersionId: null,
      prompt: 'Build a dashboard',
      spec: { title: 'Dashboard', intent: 'Inspect data', layout: 'grid', components: [], interactions: [], dataBindings: [], visualStyle: 'dark', responsiveRequirements: [] },
      source: { html: '<main>Ready</main>', css: 'main{display:grid}', javascript: '' },
      runtimePolicy: 'human', metrics: { planningMs: 10, generationMs: 20, renderMs: 5, verificationMs: 7 },
    });
    const versionId = first.versions[0].versionId;
    expect(service.get('session-1', created.canvasId)?.branches[0].headVersionId).toBe(versionId);
    expect(() => service.commit('session-1', {
      canvasId: created.canvasId,
      branchId,
      parentVersionId: null,
      prompt: 'stale',
      spec: first.versions[0].spec,
      source: first.versions[0].source,
      runtimePolicy: 'human', metrics: first.versions[0].metrics,
    })).toThrow(/branch head changed/i);
  });

  it('computes deterministic verification for manual commits and rejects premature success', () => {
    const service = createService();
    const canvas = service.create('project-1', 'session-1', 'Manual', 'Edit a Canvas');
    const committed = service.commit('session-1', {
      canvasId: canvas.canvasId, branchId: canvas.activeBranchId, parentVersionId: null, prompt: 'Manual edit',
      spec: { title: 'Manual', intent: 'Edit', layout: 'grid', components: [], interactions: [], dataBindings: [], visualStyle: 'clear', responsiveRequirements: [] },
      source: { html: '<main>Ready</main>', css: 'main{display:grid}', javascript: '' },
      verification: [], runtimePolicy: 'human', metrics: { planningMs: 0, generationMs: 0, renderMs: 0, verificationMs: 0 },
    });
    expect(committed.versions[0].verification.map(({ level, passed }) => [level, passed])).toEqual([[1, true], [2, true]]);
    expect(() => service.stop('session-1', canvas.canvasId, 'success')).toThrow(/Levels 1, 2, and 3/);
    service.recordObservation('session-1', canvas.canvasId, committed.versions[0].versionId, 'ready');
    expect(service.stop('session-1', canvas.canvasId, 'success').stopReason).toBe('success');
  });

  it('branches from a persisted version without mutating the source branch', () => {
    const service = createService();
    const canvas = service.create('project-1', 'session-1', 'Simulator', 'Create a simulator');
    const committed = service.commit('session-1', {
      canvasId: canvas.canvasId,
      branchId: canvas.activeBranchId,
      parentVersionId: null,
      prompt: 'Create a simulator',
      spec: { title: 'Simulator', intent: 'Simulate', layout: 'single', components: [], interactions: [], dataBindings: [], visualStyle: 'system', responsiveRequirements: [] },
      source: { html: '<button>Run</button>', css: '', javascript: '' },
      runtimePolicy: 'human', metrics: { planningMs: 1, generationMs: 1, renderMs: 1, verificationMs: 1 },
    });
    const branched = service.createBranch('session-1', canvas.canvasId, 'experiment', committed.versions[0].versionId);
    expect(branched.branches).toHaveLength(2);
    expect(branched.branches[0].name).toBe('main');
    expect(branched.branches[1].headVersionId).toBe(committed.versions[0].versionId);
    const switched = service.switchBranch('session-1', canvas.canvasId, branched.branches[0].branchId);
    expect(switched.activeBranchId).toBe(branched.branches[0].branchId);
  });

  it('records runtime evidence, preference feedback, exports HTML, and reports metrics', () => {
    const service = createService();
    const canvas = service.create('project-1', 'session-1', 'Interactive Tool', 'Build a tool');
    const committed = service.commit('session-1', {
      canvasId: canvas.canvasId, branchId: canvas.activeBranchId, parentVersionId: null, prompt: 'Build a tool',
      spec: { title: 'Tool', intent: 'Interact', layout: 'grid', components: [], interactions: [], dataBindings: [], visualStyle: 'clear', responsiveRequirements: [] },
      source: { html: '<main>Tool</main>', css: 'main{display:grid}', javascript: '' },
      verification: [
        { level: 1, passed: true, checks: [], observedAt: Date.now() },
        { level: 2, passed: true, checks: [], observedAt: Date.now() },
      ],
      runtimePolicy: 'human', metrics: { planningMs: 10, generationMs: 20, renderMs: 5, verificationMs: 5 },
    });
    const versionId = committed.versions[0].versionId;
    const observed = service.recordObservation('session-1', canvas.canvasId, versionId, 'ready', { latencyMs: 12 });
    expect(observed.versions[0].verification.find((entry) => entry.level === 3)?.passed).toBe(true);
    expect(observed.versions[0].usableAt).toEqual(expect.any(Number));
    service.recordFeedback('session-1', canvas.canvasId, versionId, { rating: 5, usable: true, preferredOverStatic: true });
    service.stop('session-1', canvas.canvasId, 'success');
    const exported = service.exportVersion('session-1', canvas.canvasId, versionId);
    expect(fs.readFileSync(exported.filePath, 'utf8')).toContain('RDC-Agent Generative UI');
    const summary = service.summarize('session-1');
    expect(summary.generationSuccessRate).toBe(1);
    expect(summary.loopClosureRate).toBe(1);
    expect(summary.dynamicUiPreferenceRate).toBe(1);
    expect(summary.previewReadySampleCount).toBe(1);
    expect(summary.medianPreviewReadyMs).toBe(12);
    expect(summary.medianIterationMs).toBe(47);
    expect(summary.promptToUsableSampleCount).toBe(1);
    expect(summary.medianPromptToUsableMs).toBe(observed.versions[0].usableAt! - observed.createdAt);
    expect(summary.targetStatus).toEqual({ generationSuccessRate: true, loopClosureRate: true, previewReadyLatency: true, dynamicUiPreferenceRate: true });
  });

  it('keeps L3 failed after a runtime error even if a later ready event arrives', () => {
    const service = createService();
    const canvas = service.create('project-1', 'session-1', 'Runtime', 'Build UI');
    const committed = service.commit('session-1', { canvasId: canvas.canvasId, branchId: canvas.activeBranchId, parentVersionId: null, prompt: 'Build UI',
      spec: { title: 'Runtime', intent: 'Test', layout: 'grid', components: [], interactions: [], dataBindings: [], visualStyle: 'clear', responsiveRequirements: [] },
      source: { html: '<main/>', css: '', javascript: '' }, runtimePolicy: 'human', metrics: { planningMs: 1, generationMs: 1, renderMs: 1, verificationMs: 1 } });
    const versionId = committed.versions[0].versionId;
    service.recordObservation('session-1', canvas.canvasId, versionId, 'runtime_error', { message: 'boom' });
    const ready = service.recordObservation('session-1', canvas.canvasId, versionId, 'ready');
    expect(ready.versions[0].verification.find((entry) => entry.level === 3)?.passed).toBe(false);
  });

  it('does not count five stored versions as effective iterations without a closed lineage', () => {
    const service = createService();
    let canvas = service.create('project-1', 'session-1', 'Iterations', 'Build UI');
    let parentVersionId: string | null = null;
    for (let index = 0; index < 5; index += 1) {
      canvas = service.commit('session-1', { canvasId: canvas.canvasId, branchId: canvas.activeBranchId, parentVersionId, prompt: `Iteration ${index}`,
        spec: { title: 'UI', intent: 'Test', layout: 'grid', components: [], interactions: [], dataBindings: [], visualStyle: 'clear', responsiveRequirements: [] },
        source: { html: `<main>${index}</main>`, css: '', javascript: '' }, runtimePolicy: 'human', verification: [
          { level: 1, passed: true, checks: [], observedAt: Date.now() }, { level: 2, passed: true, checks: [], observedAt: Date.now() },
        ], metrics: { planningMs: 1, generationMs: 1, renderMs: 0, verificationMs: 1 } });
      parentVersionId = canvas.versions.at(-1)!.versionId;
    }
    expect(service.summarize('session-1').canvasesWithFiveEffectiveIterations).toBe(0);
    service.recordObservation('session-1', canvas.canvasId, parentVersionId!, 'ready');
    expect(service.summarize('session-1').canvasesWithFiveEffectiveIterations).toBe(0);
  });

  it('requires observed interaction evidence when the Spec declares interactions', () => {
    const service = createService();
    const canvas = service.create('project-1', 'session-1', 'Interactive', 'Build UI');
    const committed = service.commit('session-1', { canvasId: canvas.canvasId, branchId: canvas.activeBranchId, parentVersionId: null, prompt: 'Build UI',
      spec: { title: 'Interactive', intent: 'Test', layout: 'grid', components: [], interactions: [{ trigger: 'slider input', effect: 'update output' }], dataBindings: [], visualStyle: 'clear', responsiveRequirements: [] },
      source: { html: '<input id="slider">', css: '', javascript: '' }, runtimePolicy: 'human', metrics: { planningMs: 1, generationMs: 1, renderMs: 1, verificationMs: 1 } });
    const versionId = committed.versions[0].versionId;
    const ready = service.recordObservation('session-1', canvas.canvasId, versionId, 'ready');
    expect(ready.versions[0].verification.find((entry) => entry.level === 3)?.passed).toBe(false);
    const unrelated = service.recordObservation('session-1', canvas.canvasId, versionId, 'interaction', { interactionType: 'click', message: 'H1' });
    expect(unrelated.versions[0].verification.find((entry) => entry.level === 3)?.passed).toBe(false);
    const interacted = service.recordObservation('session-1', canvas.canvasId, versionId, 'interaction', { interactionType: 'input', message: 'INPUT#slider' });
    expect(interacted.versions[0].verification.find((entry) => entry.level === 3)?.passed).toBe(true);
  });
});

describe('GenerativeUiSandbox', () => {
  it('creates a network-denied opaque-origin document', () => {
    const document = buildGenerativeUiSandboxDocument({ html: '<main>Hi</main>', css: '', javascript: 'document.body.dataset.ready="1"' });
    expect(GENERATIVE_UI_IFRAME_SANDBOX).toBe('allow-scripts');
    expect(document).toContain("connect-src 'none'");
    expect(document).toContain("form-action 'none'");
    expect(document).not.toContain('allow-same-origin');
    expect(document).toContain('rdc-generative-ui-channel');
    expect(document).toContain('new MessageChannel()');
    expect(document).toContain('e.isTrusted');
    expect(buildGenerativeUiSandboxDocument({ html: '<main>Export</main>', css: '', javascript: '' }, false)).not.toContain('rdc-generative-ui');
  });
});
