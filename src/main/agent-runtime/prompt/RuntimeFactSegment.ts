import type { PromptPlan, PromptSegment } from '@shared/types/rdcRuntime';
import { charsToTokens } from '@shared/utils/tokens';
import { hashScopedResource } from '../../runtime/ScopedResourceResolver';

/** Replace a volatile main-owned fact before preparation freezes the prompt. */
export function applyRuntimeFact(plan: PromptPlan, fact: { id: string; sourcePath: string; content: string }): PromptPlan {
  const segment: PromptSegment = {
    ...fact, kind: 'runtime-fact', scope: 'runtime', stability: 'volatile',
    sourceHash: hashScopedResource(fact.content), tokenEstimate: charsToTokens(fact.content.length), precedence: 0,
  };
  const segments = [...plan.segments.filter(item => item.id !== fact.id), segment]
    .map((item, precedence) => ({ ...item, precedence }));
  const systemPrompt = segments.map(item => item.content).join('\n\n');
  const scopedInstructions = segments.filter(item => item.kind === 'scoped-instruction').reduce((sum, item) => sum + item.content.length, 0);
  const skills = segments.filter(item => item.kind === 'preloaded-skill' || item.kind === 'skill-catalog').reduce((sum, item) => sum + item.content.length, 0);
  return {
    ...plan, segments, systemPrompt,
    totalTokenEstimate: segments.reduce((sum, item) => sum + item.tokenEstimate, 0),
    stablePrefix: { ...plan.stablePrefix, volatileSegmentIds: segments.filter(item => item.stability === 'volatile').map(item => item.id) },
    metrics: { systemPrompt: Math.max(0, systemPrompt.length - scopedInstructions - skills), scopedInstructions, skills },
  };
}
