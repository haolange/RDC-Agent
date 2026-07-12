import type { GenerativeUiSource, GenerativeUiSpec, GenerativeUiVerificationResult } from '@shared/types/generativeUi';

export interface GenerativeUiModelUsage { inputTokens?: number; outputTokens?: number; estimatedCostUsd?: number }
export interface GenerativeUiModelCallContext {
  sessionId: string;
  turnId: string;
  phase: 'plan' | 'generate' | 'reflect' | 'runtime-reflect';
  images?: Array<{ mediaType: string; data: string }>;
}
export interface GenerativeUiPlanner {
  plan(prompt: string, previous?: { spec: GenerativeUiSpec; reflection: string | null }, context?: GenerativeUiModelCallContext): Promise<{ spec: GenerativeUiSpec; usage?: GenerativeUiModelUsage; noOpReason?: string }>;
}
export interface GenerativeUiGenerator {
  generate(prompt: string, spec: GenerativeUiSpec, previous?: GenerativeUiSource, context?: GenerativeUiModelCallContext): Promise<{ source: GenerativeUiSource; usage?: GenerativeUiModelUsage }>;
}
export interface GenerativeUiReflector {
  reflect(spec: GenerativeUiSpec, source: GenerativeUiSource, verification: GenerativeUiVerificationResult[], context?: GenerativeUiModelCallContext): Promise<{ reflection: string; shouldContinue: boolean; usage?: GenerativeUiModelUsage }>;
}
export const sumGenerativeUiUsage = (values: Array<GenerativeUiModelUsage | undefined>): GenerativeUiModelUsage => values.reduce<GenerativeUiModelUsage>((total, value) => ({
  inputTokens: (total.inputTokens ?? 0) + (value?.inputTokens ?? 0), outputTokens: (total.outputTokens ?? 0) + (value?.outputTokens ?? 0),
  estimatedCostUsd: (total.estimatedCostUsd ?? 0) + (value?.estimatedCostUsd ?? 0),
}), {});
