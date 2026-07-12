import { GENERATIVE_UI_BENCHMARK_CASES, GENERATIVE_UI_BENCHMARK_VERSION } from '@shared/constants/generativeUiBenchmark';
import type { GenerativeUiBenchmarkCase, GenerativeUiLoopResult } from '@shared/types/generativeUi';
import { GenerativeUiInnerLoop } from './GenerativeUiInnerLoop';
import { LlmGenerativeUiModel } from './LlmGenerativeUiModel';

const model = new LlmGenerativeUiModel();
const loop = new GenerativeUiInnerLoop(model, model, model);

export class GenerativeUiBenchmarkService {
  list(): { version: string; cases: GenerativeUiBenchmarkCase[] } {
    return { version: GENERATIVE_UI_BENCHMARK_VERSION, cases: GENERATIVE_UI_BENCHMARK_CASES };
  }

  async run(projectId: string, sessionId: string, caseId: string): Promise<GenerativeUiLoopResult> {
    const benchmark = GENERATIVE_UI_BENCHMARK_CASES.find((entry) => entry.caseId === caseId);
    if (!benchmark) throw new Error(`Generative UI benchmark case not found: ${caseId}`);
    return loop.run({ projectId, sessionId, benchmarkCaseId: benchmark.caseId, title: `[Benchmark] ${benchmark.title}`, prompt: benchmark.prompt,
      checkpoint: 'automatic', budget: { maxIterations: 5, maxTotalMs: 180_000, maxInputTokens: 100_000, maxOutputTokens: 60_000,
        maxEstimatedCostUsd: 5, maxStagnantIterations: 2 } });
  }
}

export const generativeUiBenchmarkService = new GenerativeUiBenchmarkService();
