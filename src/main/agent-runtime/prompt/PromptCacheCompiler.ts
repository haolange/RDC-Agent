import { hashScopedResource } from '../../runtime/ScopedResourceResolver';
import type { RequestPlan } from '@shared/types/providerCapability';
import type { PromptPlan } from '@shared/types/rdcRuntime';
import type { CompiledPromptCache } from '@shared/types/semanticContext';

export interface PromptCacheCompileInput {
  promptPlan: PromptPlan;
  requestPlan: RequestPlan;
  tools: unknown[];
  /** Execution scope (session or delegated child) whose requests share one cache affinity. */
  affinityScopeId?: string;
}

/** A stable, opaque UUID-shaped key: the same scope always routes to the same cache. */
function scopeAffinityKey(scopeId: string): string {
  const hex = hashScopedResource({ cacheAffinityScope: scopeId }).replace(/^sha256:/u, '').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const disabledCache = (
  input: PromptCacheCompileInput,
  reason: string,
): CompiledPromptCache => ({
  enabled: false,
  mode: input.requestPlan.cachePlan.mode,
  keyCarrier: input.requestPlan.cachePlan.keyCarrier,
  breakpointCarrier: input.requestPlan.cachePlan.breakpointCarrier,
  ttl: input.requestPlan.cachePlan.ttl,
  breakpoint: 'none',
  stableSegmentIds: [...input.promptPlan.stablePrefix.segmentIds],
  stableTokenEstimate: input.promptPlan.stablePrefix.tokenEstimate,
  providerReported: input.requestPlan.cachePlan.telemetry.length > 0,
  reason,
});

export class PromptCacheCompiler {
  compile(input: PromptCacheCompileInput): CompiledPromptCache {
    const plan = input.requestPlan.cachePlan;
    if (!plan.enabled || plan.mode === 'none' || plan.mode === 'unknown') {
      return disabledCache(input, 'Provider contract does not declare an executable cache path.');
    }
    if (input.promptPlan.stablePrefix.segmentIds.length === 0) {
      return disabledCache(input, 'PromptPlan contains no stable prefix segments.');
    }

    const prefixFingerprint = hashScopedResource({
      providerId: input.requestPlan.providerId,
      protocol: input.requestPlan.route.protocol,
      adapterId: input.requestPlan.adapterId,
      effectiveModelId: input.requestPlan.effectiveModelId,
      promptPrefix: input.promptPlan.stablePrefix.fingerprint,
      tools: input.tools,
    });
    const providerReported = plan.telemetry.length > 0;
    if (plan.keyCarrier === 'session-id-and-prompt-cache-key' && !input.affinityScopeId) {
      return disabledCache(input, 'Session-affine cache requires the execution scope.');
    }
    const requestKey = plan.keyCarrier === 'prompt-cache-key'
      ? `rdc:${prefixFingerprint.slice(0, 48)}`
      : plan.keyCarrier === 'session-id-and-prompt-cache-key' ? scopeAffinityKey(input.affinityScopeId!) : undefined;

    let breakpoint: CompiledPromptCache['breakpoint'];
    if (plan.mode === 'implicit-prefix' || plan.mode === 'provider-managed') {
      breakpoint = 'implicit';
    } else if (plan.mode === 'automatic-breakpoint') {
      if (
        plan.breakpointCarrier !== 'anthropic-cache-control'
        && plan.breakpointCarrier !== 'provider-managed'
      ) {
        return disabledCache(input, 'Automatic cache mode has no compatible breakpoint carrier.');
      }
      breakpoint = 'automatic';
    } else if (plan.mode === 'explicit-breakpoints') {
      if (
        plan.breakpointCarrier !== 'openai-prompt-cache'
        && plan.breakpointCarrier !== 'anthropic-cache-control'
      ) {
        return disabledCache(input, 'Explicit cache mode has no compatible breakpoint carrier.');
      }
      breakpoint = 'explicit';
    } else {
      // automatic-and-explicit-breakpoints
      if (
        plan.breakpointCarrier !== 'openai-prompt-cache'
        && plan.breakpointCarrier !== 'anthropic-cache-control'
      ) {
        return disabledCache(input, 'Combined cache mode has no compatible breakpoint carrier.');
      }
      breakpoint = 'automatic-and-explicit';
    }

    const reason = [
      plan.keyCarrier === 'prompt-cache-key' ? 'Stable prompt and tool prefix compiled to prompt_cache_key.' : '',
      plan.keyCarrier === 'session-id-and-prompt-cache-key' ? 'Execution scope compiled to prompt_cache_key and the session-id header.' : '',
      breakpoint === 'implicit' ? 'Provider performs implicit prefix caching.' : '',
      breakpoint === 'automatic' ? 'Provider automatic breakpoint enabled.' : '',
      breakpoint === 'explicit' ? 'Stable prefix compiled to an explicit cache breakpoint.' : '',
      breakpoint === 'automatic-and-explicit'
        ? 'Provider automatic caching and an explicit stable-prefix breakpoint enabled.'
        : '',
    ].filter(Boolean).join(' ');

    return {
      enabled: true,
      mode: plan.mode,
      keyCarrier: plan.keyCarrier,
      breakpointCarrier: plan.breakpointCarrier,
      ttl: plan.ttl,
      prefixFingerprint,
      ...(requestKey ? { requestKey } : {}),
      breakpoint,
      stableSegmentIds: [...input.promptPlan.stablePrefix.segmentIds],
      stableTokenEstimate: input.promptPlan.stablePrefix.tokenEstimate,
      providerReported,
      reason,
    };
  }
}

export const promptCacheCompiler = new PromptCacheCompiler();
