/**
 * Compile a Delegation Capsule into PromptPlan segments and join them
 * the same way PromptPlanBuilder joins system-prompt segments.
 */

import type { PromptPlan, PromptSegment } from '@shared/types/rdxRuntime';
import type { DelegationCapsule } from '@shared/types/delegationCapsule';
import { charsToTokens } from '@shared/utils/tokens';
import { hashScopedResource } from '../../runtime/ScopedResourceResolver';

function pushSegment(
  segments: PromptSegment[],
  id: string,
  content: string,
): void {
  const trimmed = content.trim();
  if (!trimmed) return;
  segments.push({
    id,
    kind: 'delegation-capsule',
    scope: 'runtime',
    sourcePath: `runtime://delegation/${id}`,
    sourceHash: hashScopedResource(trimmed),
    precedence: segments.length,
    content: trimmed,
    stability: 'volatile',
    tokenEstimate: charsToTokens(trimmed.length),
  });
}

function renderList(title: string, items: string[], empty: string): string {
  if (items.length === 0) {
    return `# ${title}\n\n${empty}`;
  }
  return `# ${title}\n\n${items.map((item) => `- ${item}`).join('\n')}`;
}

/** Compile a validated capsule into volatile PromptPlan segments. */
export function compileDelegationCapsule(capsule: DelegationCapsule): PromptSegment[] {
  const segments: PromptSegment[] = [];
  pushSegment(segments, 'delegation:mission', `# Delegation Mission\n\n${capsule.mission}`);
  pushSegment(segments, 'delegation:task', `# Delegation Task\n\n${capsule.task}`);
  pushSegment(
    segments,
    'delegation:accepted-facts',
    renderList('Accepted Facts', capsule.acceptedFacts, 'None recorded.'),
  );
  pushSegment(
    segments,
    'delegation:forbidden-paths',
    renderList('Forbidden Paths', capsule.forbiddenPaths, 'None recorded.'),
  );
  pushSegment(
    segments,
    'delegation:input-artifacts',
    renderList('Input Artifact Refs', capsule.inputArtifactRefs, 'None provided. Use artifact_read only if a later tool result supplies a session:// ref.'),
  );
  pushSegment(
    segments,
    'delegation:output-requirements',
    `# Output Requirements\n\n${capsule.outputRequirements}`,
  );
  const budgetLines = [
    '# Delegation Budget',
    `maxToolCalls: ${capsule.budget.maxToolCalls}`,
    `maxWallTimeMs: ${capsule.budget.maxWallTimeMs}`,
  ];
  if (capsule.budget.maxSubagents !== undefined) {
    budgetLines.push(`maxSubagents: ${capsule.budget.maxSubagents}`);
  }
  pushSegment(segments, 'delegation:budget', budgetLines.join('\n'));
  pushSegment(
    segments,
    'delegation:lease',
    `# RDX Lease\n\nrequiresRdxLease: ${capsule.requiresRdxLease ? 'true' : 'false'}\n${
      capsule.requiresRdxLease
        ? 'This child may use a delegated parent RDX / Live Capture lease. Do not run in a concurrent tool group.'
        : 'This child is offline. Do not request or assume an RDX lease.'
    }`,
  );
  return Object.freeze(segments.map((segment) => Object.freeze(segment))) as PromptSegment[];
}

/** Join capsule segments the same way PromptPlan joins system-prompt segments. */
export function renderDelegationCapsulePrompt(segments: readonly PromptSegment[]): string {
  return segments.map((segment) => segment.content).join('\n\n');
}

/** Append volatile capsule segments to an existing child PromptPlan. */
export function applyDelegationCapsuleToPromptPlan(
  plan: PromptPlan,
  extra: readonly PromptSegment[],
): PromptPlan {
  if (extra.length === 0) return plan;
  const start = plan.segments.length;
  const appended = extra.map((segment, index) => ({
    ...segment,
    kind: 'delegation-capsule' as const,
    stability: 'volatile' as const,
    precedence: start + index,
  }));
  const segments = [...plan.segments, ...appended];
  const systemPrompt = segments.map((segment) => segment.content).join('\n\n');
  return {
    ...plan,
    segments,
    systemPrompt,
    totalTokenEstimate: segments.reduce((sum, segment) => sum + segment.tokenEstimate, 0),
    stablePrefix: {
      ...plan.stablePrefix,
      volatileSegmentIds: [
        ...plan.stablePrefix.volatileSegmentIds,
        ...appended.map((segment) => segment.id),
      ],
    },
  };
}
