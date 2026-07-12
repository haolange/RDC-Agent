import { describe, expect, it } from 'vitest';
import type { GenerativeUiCanvas, GenerativeUiVersion } from '@shared/types/generativeUi';
import { summarizeGenerativeUiEvidence } from './GenerativeUiEvidence';

const version = (id: string, usableAt?: number, level3ObservedAt = usableAt): GenerativeUiVersion => ({
  versionId: id, parentVersionId: null, branchId: 'main', prompt: 'Build UI', contextReferences: [],
  spec: { title: 'UI', intent: 'Interact', layout: 'grid', components: [], interactions: [], dataBindings: [], visualStyle: 'clear', responsiveRequirements: [] },
  source: { html: '<main>UI</main>', css: 'main{display:grid}', javascript: '' }, reflection: null,
  runtimePolicy: 'human', runtimeDecision: null, runtimeReflection: null, usableAt,
  verification: [1, 2, 3].map((level) => ({ level: level as 1 | 2 | 3, passed: level !== 3 || level3ObservedAt !== undefined,
    checks: [], observedAt: level === 3 ? level3ObservedAt ?? 0 : 0 })),
  metrics: { planningMs: 10, generationMs: 20, renderMs: 5, verificationMs: 5 }, createdAt: 0,
});

const canvas = (id: string, createdAt: number, versions: GenerativeUiVersion[]): GenerativeUiCanvas => ({
  schemaVersion: 1, canvasId: id, projectId: 'project', sessionId: 'session', title: id, originalPrompt: 'Build UI',
  activeBranchId: 'main', branches: [{ branchId: 'main', name: 'main', headVersionId: versions.at(-1)?.versionId ?? null,
    createdFromVersionId: null, createdAt }], versions, observations: [], feedback: [], stopReason: null, createdAt, updatedAt: createdAt,
});

describe('summarizeGenerativeUiEvidence prompt-to-usable metric', () => {
  it('uses the first persisted L3-usable timestamp per Canvas and excludes canvases without L3', () => {
    const summary = summarizeGenerativeUiEvidence([
      canvas('first', 1_000, [version('v1', 4_000), version('v2', 2_000)]),
      canvas('legacy', 100, [version('v3', undefined, 3_100)]),
      canvas('open', 500, [version('v4')]),
    ]);
    expect(summary.promptToUsableSampleCount).toBe(2);
    expect(summary.medianPromptToUsableMs).toBe(2_000);
  });
});
