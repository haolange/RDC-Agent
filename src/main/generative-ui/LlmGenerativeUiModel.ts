import type { LLMRequest, LLMResponse } from '@shared/types/llm';
import type { GenerativeUiSource, GenerativeUiSpec, GenerativeUiVerificationResult } from '@shared/types/generativeUi';
import { llmAdapter, type LLMAdapter } from '../settings/LLMAdapter';
import { settingsService, type SettingsService } from '../settings/SettingsService';
import type { GenerativeUiGenerator, GenerativeUiModelCallContext, GenerativeUiPlanner, GenerativeUiReflector } from './GenerativeUiModelContracts';
import { generativeUiRequestTrace, type GenerativeUiRequestTrace } from './GenerativeUiRequestTrace';
import { z } from 'zod';

const SYSTEM = `You are the RDC-Agent Generative UI engine. Return only valid JSON. Generate original, runnable Web UI rather than templates. Prioritize usability, accessibility, responsive behavior, and working interactions. The runtime is a sandbox with no network, storage, parent-frame access, or external assets.`;

const responseText = (response: LLMResponse): string => typeof response.content === 'string'
  ? response.content
  : response.content.map((block) => block.type === 'text' ? block.text ?? '' : '').join('');

const specSchema = z.object({ title: z.string().min(1), intent: z.string().min(1), layout: z.string().min(1),
  components: z.array(z.object({ id: z.string().min(1), kind: z.string().min(1), purpose: z.string().min(1) })).max(100),
  interactions: z.array(z.object({ trigger: z.string().min(1), effect: z.string().min(1) })).max(100),
  dataBindings: z.array(z.object({ source: z.string().min(1), target: z.string().min(1) })).max(100),
  visualStyle: z.string().min(1), responsiveRequirements: z.array(z.string().min(1)).max(50) });
const planSchema = z.object({ suitable: z.boolean(), noOpReason: z.string().nullable().optional(), spec: specSchema });
const sourceSchema = z.object({ html: z.string().min(1).max(1_000_000), css: z.string().max(1_000_000), javascript: z.string().max(1_000_000) });
const reflectionSchema = z.object({ reflection: z.string().min(1), shouldContinue: z.boolean() });

export const parseGenerativeUiJson = <T>(response: LLMResponse, schema: z.ZodType<T>): T => {
  const text = responseText(response).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return schema.parse(JSON.parse(text));
  } catch (error) {
    const detail = error instanceof z.ZodError ? error.issues.slice(0, 5).map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') : 'invalid JSON syntax';
    throw new Error(`Generative UI model returned an invalid structured response: ${detail}`);
  }
};

export class LlmGenerativeUiModel implements GenerativeUiPlanner, GenerativeUiGenerator, GenerativeUiReflector {
  constructor(
    private readonly adapter: LLMAdapter = llmAdapter,
    private readonly settings: SettingsService = settingsService,
    private readonly trace: GenerativeUiRequestTrace = generativeUiRequestTrace,
  ) {}

  async plan(prompt: string, previous?: { spec: GenerativeUiSpec; reflection: string | null }, context?: GenerativeUiModelCallContext) {
    const response = await this.call(`Plan an interactive UI for this request:\n${prompt}\nPrevious state: ${JSON.stringify(previous ?? null)}\nReturn {"suitable":boolean,"noOpReason":string|null,"spec":{"title":string,"intent":string,"layout":string,"components":[{"id":string,"kind":string,"purpose":string}],"interactions":[{"trigger":string,"effect":string}],"dataBindings":[{"source":string,"target":string}],"visualStyle":string,"responsiveRequirements":string[]}}.`, context);
    const value = parseGenerativeUiJson(response, planSchema);
    return {
      spec: value.spec,
      noOpReason: value.suitable ? undefined : value.noOpReason || 'The request is not suitable for an interactive UI.',
      usage: { ...response.usage },
    };
  }

  async generate(prompt: string, spec: GenerativeUiSpec, previous?: GenerativeUiSource, context?: GenerativeUiModelCallContext) {
    const response = await this.call(`Implement this UI as self-contained HTML, CSS, and JavaScript.\nRequest: ${prompt}\nSpec: ${JSON.stringify(spec)}\nPrevious source: ${JSON.stringify(previous ?? null)}\nReturn {"html":string,"css":string,"javascript":string}. Do not use external libraries or network calls.`, context);
    return { source: parseGenerativeUiJson(response, sourceSchema), usage: { ...response.usage } };
  }

  async reflect(spec: GenerativeUiSpec, source: GenerativeUiSource, verification: GenerativeUiVerificationResult[], context?: GenerativeUiModelCallContext) {
    const response = await this.call(`Review this generated UI against its spec and verifier output.\nSpec: ${JSON.stringify(spec)}\nSource: ${JSON.stringify(source)}\nVerification: ${JSON.stringify(verification)}\nReturn {"reflection":string,"shouldContinue":boolean}. Continue only when a concrete repair is required.`, context);
    const value = parseGenerativeUiJson(response, reflectionSchema);
    return { ...value, usage: { ...response.usage } };
  }

  private async call(userPrompt: string, context?: GenerativeUiModelCallContext): Promise<LLMResponse> {
    const config = this.settings.getLlmConfig();
    const route = config.agentRoutes.find((entry) => entry.agentId === 'edit');
    if (!route?.providerId || !route.modelId) {
      throw new Error('Generative UI requires a configured Edit agent provider and model route.');
    }
    const userContent = context?.images?.length ? [
      { type: 'text' as const, text: userPrompt },
      ...context.images.map((image) => ({ type: 'image' as const, source: { type: 'base64', media_type: image.mediaType, data: image.data } })),
    ] : userPrompt;
    const request: LLMRequest = {
      model: route.modelId,
      responseFormat: 'json_object',
      temperature: 0.35,
      maxTokens: 16_384,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userContent },
      ],
    };
    const provider = config.providers.find((entry) => entry.id === route.providerId);
    const snapshotId = this.trace.begin(SYSTEM, request, { providerId: route.providerId, modelId: route.modelId, protocol: provider?.protocol ?? 'unknown' }, context);
    const response = await this.adapter.chat(request, route.providerId);
    this.trace.complete(snapshotId, response, context);
    return response;
  }
}
