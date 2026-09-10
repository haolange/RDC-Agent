import type { RequestPlan } from '@shared/types/providerCapability';
import type { PromptPlan } from '@shared/types/rdxRuntime';
import type { CompiledPromptCache } from '@shared/types/semanticContext';
import { hashScopedResource } from '../../runtime/ScopedResourceResolver';

export interface PromptCacheCompileInput {
  promptPlan: PromptPlan;
  requestPlan: RequestPlan;
  tools: unknown[];
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
    const requestKey = plan.keyCarrier === 'prompt-cache-key'
      ? `rdc:${prefixFingerprint.slice(0, 48)}`
      : undefined;

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
    } else if (plan.mode === 'automatic-and-explicit-breakpoints') {
      if (
        plan.breakpointCarrier !== 'openai-prompt-cache'
        && plan.breakpointCarrier !== 'anthropic-cache-control'
      ) {
        return disabledCache(input, 'Combined cache mode has no compatible breakpoint carrier.');
      }
      breakpoint = 'automatic-and-explicit';
    } else {
      return disabledCache(input, 'Cache contract has no supported compiler target.');
    }

    const reason = [
      requestKey ? 'Stable prompt and tool prefix compiled to prompt_cache_key.' : '',
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
