import { describe, expect, it } from 'vitest';
import { GENERATIVE_UI_BENCHMARK_CASES, GENERATIVE_UI_BENCHMARK_VERSION } from '@shared/constants/generativeUiBenchmark';

describe('Generative UI canonical benchmark', () => {
  it('covers every v1 product family with unique complex cases', () => {
    expect(GENERATIVE_UI_BENCHMARK_VERSION).toBe('v1.0.0');
    expect(GENERATIVE_UI_BENCHMARK_CASES).toHaveLength(20);
    expect(new Set(GENERATIVE_UI_BENCHMARK_CASES.map((entry) => entry.caseId)).size).toBe(20);
    for (const category of ['website', 'dashboard', 'simulator', 'tool', 'visualization', 'game']) {
      expect(GENERATIVE_UI_BENCHMARK_CASES.filter((entry) => entry.category === category).length).toBeGreaterThanOrEqual(3);
    }
    for (const entry of GENERATIVE_UI_BENCHMARK_CASES) {
      expect(entry.prompt.length).toBeGreaterThan(150);
      expect(entry.requiredInteractions.length).toBeGreaterThanOrEqual(3);
      expect(entry.requiredEvidence.length).toBeGreaterThanOrEqual(2);
    }
  });
});
