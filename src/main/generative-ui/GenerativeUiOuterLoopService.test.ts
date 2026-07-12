import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }));
import { GenerativeUiCanvasService } from './GenerativeUiCanvasService';
import { GenerativeUiOuterLoopService } from './GenerativeUiOuterLoopService';
import { GENERATIVE_UI_BENCHMARK_CASES } from '@shared/constants/generativeUiBenchmark';

const roots: string[] = [];
const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-outer-loop-'));
  roots.push(root);
  const canvases = new GenerativeUiCanvasService(path.join(root, 'canvases'));
  return { canvases, outer: new GenerativeUiOuterLoopService(path.join(root, 'evaluation'), canvases) };
};
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

describe('GenerativeUiOuterLoopService', () => {
  it('rejects preference claims that were not blinded and randomized', () => {
    const { outer } = setup();
    expect(() => outer.add('session', { kind: 'blind_preference', title: 'Test', source: 'panel-1', notes: '', outcome: 'dynamic' }))
      .toThrow(/blinded=true/i);
  });

  it('rejects unbound use cases and duplicate or unscored expert reviews', () => {
    const { outer } = setup();
    expect(() => outer.add('session', { kind: 'use_case', title: 'Claim', source: 'user-1', notes: 'Observed.' }))
      .toThrow(/Canvas\/version/);
    expect(() => outer.add('session', { kind: 'expert_review', title: 'Review', source: 'expert-1', notes: '' }))
      .toThrow(/score and review notes/);
    outer.add('session', { kind: 'expert_review', title: 'Review', source: 'expert-1', notes: 'Reviewed.', score: 80 });
    expect(() => outer.add('session', { kind: 'expert_review', title: 'Again', source: 'EXPERT-1', notes: 'Reviewed.', score: 90 }))
      .toThrow(/already recorded/);
  });

  it('persists evidence and derives release readiness only from sufficient proof', () => {
    const { canvases, outer } = setup();
    const artifacts: Array<{ canvasId: string; versionId: string }> = [];
    for (let index = 0; index < 20; index += 1) {
      let canvas = canvases.create('project', 'session', `Case ${index}`, `Prompt ${index}`, GENERATIVE_UI_BENCHMARK_CASES[index].caseId);
      const iterations = index === 0 ? 5 : 1;
      let parentVersionId: string | null = null;
      for (let iteration = 0; iteration < iterations; iteration += 1) {
        canvas = canvases.commit('session', { canvasId: canvas.canvasId, branchId: canvas.activeBranchId, parentVersionId,
          prompt: `Prompt ${index}.${iteration}`, spec: { title: 'UI', intent: 'Test', layout: 'grid', components: [], interactions: [], dataBindings: [], visualStyle: 'clear', responsiveRequirements: [] },
          source: { html: `<main>${iteration}</main>`, css: '', javascript: '' }, verification: [
            { level: 1, passed: true, checks: [], observedAt: Date.now() }, { level: 2, passed: true, checks: [], observedAt: Date.now() },
          ], runtimePolicy: 'human', metrics: { planningMs: 1, generationMs: 1, renderMs: 1, verificationMs: 1 } });
        parentVersionId = canvas.versions.at(-1)!.versionId;
        canvases.recordObservation('session', canvas.canvasId, parentVersionId, 'ready', { latencyMs: 25 });
      }
      canvases.stop('session', canvas.canvasId, 'success');
      artifacts.push({ canvasId: canvas.canvasId, versionId: parentVersionId! });
    }
    for (let index = 0; index < 5; index += 1) outer.add('session', { kind: 'use_case', title: `Case ${index}`, source: `user-${index}`, notes: 'Observed use.', ...artifacts[index] });
    for (let index = 0; index < 3; index += 1) outer.add('session', { kind: 'expert_review', title: `Review ${index}`, source: `expert-${index}`, notes: 'Reviewed.', score: 85 });
    outer.add('session', { kind: 'competitor_observation', title: 'Competitor review', source: 'https://example.test/review', notes: 'Dated observation.' });
    for (let index = 0; index < 20; index += 1) outer.add('session', { kind: 'blind_preference', title: `Panel ${index}`, source: `panel-${index}`, notes: '', blinded: true,
      ...artifacts[index], staticReference: `static-response-${index}`, candidateOrder: index % 2 ? 'dynamic_first' : 'static_first', outcome: index < 13 ? 'dynamic' : 'static' });
    expect(() => outer.add('session', { kind: 'blind_preference', title: 'Duplicate', source: 'panel-0', notes: '', blinded: true,
      ...artifacts[0], staticReference: 'static-response-0', candidateOrder: 'dynamic_first', outcome: 'dynamic' })).toThrow(/already recorded/i);
    const report = outer.report('session');
    expect(report.decision).toBe('v1_ready');
    expect(report.gaps).toEqual([]);
    expect(report.metrics.dynamicUiPreferenceRate).toBe(0.65);
    expect(report.metrics.canvasesWithFiveEffectiveIterations).toBe(1);
    expect(report.metrics.targetStatus.previewReadyLatency).toBe(true);
    expect(report.benchmark).toMatchObject({ caseCount: 20, successfulCaseCount: 20 });
    expect(outer.list('session')).toHaveLength(29);
  });
});
