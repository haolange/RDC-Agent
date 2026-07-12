import type { AgentTool } from '../agent-runtime/agent/AgentTool';
import { createHash } from 'crypto';
import type { GenerativeUiContextReference } from '@shared/types/generativeUi';
import { generativeUiCanvasService } from './GenerativeUiCanvasService';
import { GenerativeUiInnerLoop } from './GenerativeUiInnerLoop';
import { LlmGenerativeUiModel } from './LlmGenerativeUiModel';

type Action = 'generate' | 'refine' | 'inspect' | 'export' | 'metrics' | 'simulate';
interface Args {
  [key: string]: unknown;
  action: Action; prompt?: string; title?: string; canvasId?: string; branchId?: string; versionId?: string;
  dataContext?: { source: string; value: Record<string, unknown> }; assets?: Array<{ name: string; source: string; dataUrl: string; alt?: string }>;
  simulation?: { steps?: number; initialValue?: number; rate?: number; noise?: number; seed?: number };
}

const model = new LlmGenerativeUiModel();
const loop = new GenerativeUiInnerLoop(model, model, model);
const required = (value: string | undefined, name: string): string => {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
};
const validateInputs = (args: Args): void => {
  if ((args.prompt?.length ?? 0) > 20_000) throw new Error('prompt exceeds the 20,000 character limit.');
  if (args.dataContext !== undefined && JSON.stringify(args.dataContext).length > 200_000) throw new Error('dataContext exceeds the 200,000 character limit.');
  if (args.dataContext && !args.dataContext.source.trim()) throw new Error('dataContext.source is required.');
  const assets = args.assets ?? [];
  if (assets.length > 20) throw new Error('assets exceeds the 20 item limit.');
  if (assets.some((asset) => !asset.source.trim())) throw new Error('Every asset requires a source.');
  if (assets.some((asset) => !/^data:image\/(?:png|jpeg|webp|gif|svg\+xml);base64,/i.test(asset.dataUrl))) {
    throw new Error('assets must be base64 image data URLs.');
  }
  if (assets.reduce((total, asset) => total + asset.dataUrl.length, 0) > 2_800_000) throw new Error('assets exceed the 2 MB encoded payload limit.');
};
const reference = (kind: GenerativeUiContextReference['kind'], name: string, source: string, payload: string): GenerativeUiContextReference => ({
  kind, name, source, scope: 'session', hash: `sha256:${createHash('sha256').update(payload).digest('hex')}`,
  precedence: 'supplemental', redaction: 'caller_redacted',
});
const simulate = (input: NonNullable<Args['simulation']> = {}) => {
  const steps = Math.min(500, Math.max(1, Math.floor(input.steps ?? 30)));
  const rate = Number.isFinite(input.rate) ? input.rate! : 0.02;
  const noise = Math.max(0, Number.isFinite(input.noise) ? input.noise! : 0);
  let seed = Math.floor(input.seed ?? 1) >>> 0;
  let value = Number.isFinite(input.initialValue) ? input.initialValue! : 100;
  return Array.from({ length: steps }, (_, index) => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    value *= 1 + rate + (seed / 0x100000000 - 0.5) * noise;
    return { step: index + 1, value: Number(value.toFixed(6)) };
  });
};

export function createGenerativeUiAgentTool(): AgentTool<Args> {
  return {
    name: 'generative_ui', label: 'Generative UI Canvas',
    description: 'Generate, refine, inspect, export, or evaluate a persistent interactive Canvas. Compose with web/MCP data and image tools by passing explicit outputs as dataContext or embedded data-URL assets. Includes bounded deterministic simulation.',
    parameters: { type: 'object', required: ['action'], properties: {
      action: { type: 'string', enum: ['generate', 'refine', 'inspect', 'export', 'metrics', 'simulate'] },
      prompt: { type: 'string' }, title: { type: 'string' }, canvasId: { type: 'string' }, branchId: { type: 'string' }, versionId: { type: 'string' },
      dataContext: { type: 'object', required: ['source', 'value'], description: 'Caller-redacted structured data with an explicit source.', properties: { source: { type: 'string' }, value: { type: 'object' } } },
      assets: { type: 'array', items: { type: 'object', required: ['name', 'source', 'dataUrl'], properties: { name: { type: 'string' }, source: { type: 'string' }, dataUrl: { type: 'string' }, alt: { type: 'string' } } } },
      simulation: { type: 'object', properties: { steps: { type: 'number' }, initialValue: { type: 'number' }, rate: { type: 'number' }, noise: { type: 'number' }, seed: { type: 'number' } } },
    } },
    permissionHint: 'session_mutation',
    spec: { isReadOnly: false, isConcurrencySafe: false, isDestructive: false, sideEffect: 'session', category: 'system', requiresApproval: false },
    async execute(_id, args, signal, onUpdate, context) {
      try {
        if (signal?.aborted) throw new Error('Generative UI operation was aborted.');
        validateInputs(args);
        const sessionId = context?.sessionId;
        if (!sessionId) throw new Error('Generative UI requires an active session.');
        if (args.action === 'simulate') {
          const series = simulate(args.simulation);
          return { content: [{ type: 'text', text: JSON.stringify(series) }], details: { action: args.action, series } };
        }
        if (args.action === 'metrics') {
          const summary = generativeUiCanvasService.summarize(sessionId);
          return { content: [{ type: 'text', text: JSON.stringify(summary) }], details: { action: args.action, summary } };
        }
        if (args.action === 'inspect') {
          const value = args.canvasId ? generativeUiCanvasService.get(sessionId, args.canvasId) : generativeUiCanvasService.list(sessionId);
          return { content: [{ type: 'text', text: JSON.stringify(value) }], details: { action: args.action, value } };
        }
        if (args.action === 'export') {
          const result = generativeUiCanvasService.exportVersion(sessionId, required(args.canvasId, 'canvasId'), required(args.versionId, 'versionId'));
          return { content: [{ type: 'text', text: `Canvas exported: ${result.filePath}` }], details: { action: args.action, ...result } };
        }
        const prompt = required(args.prompt, 'prompt');
        const dataPayload = args.dataContext === undefined ? '' : JSON.stringify(args.dataContext.value);
        const contextReferences: GenerativeUiContextReference[] = [
          ...(args.dataContext ? [reference('data', 'dataContext', args.dataContext.source, dataPayload)] : []),
          ...(args.assets ?? []).map((asset) => reference('asset', asset.name, asset.source, asset.dataUrl)),
        ];
        const modelPrompt = `${prompt}${args.dataContext === undefined ? '' : `\n\nSupplemental caller-redacted data (${args.dataContext.source}):\n${dataPayload}`}${args.assets?.length ? `\n\nAttached image assets:\n${JSON.stringify(args.assets.map(({ name, source, alt }) => ({ name, source, alt })))}` : ''}`;
        const modelImages = (args.assets ?? []).map((asset) => {
          const match = /^data:(image\/(?:png|jpeg|webp|gif|svg\+xml));base64,(.+)$/i.exec(asset.dataUrl);
          if (!match) throw new Error(`Invalid image asset: ${asset.name}`);
          return { mediaType: match[1].toLowerCase(), data: match[2] };
        });
        onUpdate?.({ stage: 'generating', canvasId: args.canvasId ?? null });
        const result = await loop.run({
          projectId: context?.projectId ?? 'unscoped', sessionId, prompt, modelPrompt, modelImages, contextReferences, title: args.title,
          canvasId: args.action === 'refine' ? required(args.canvasId, 'canvasId') : undefined, branchId: args.branchId,
          checkpoint: 'automatic', budget: { maxIterations: 5, maxTotalMs: 180_000, maxInputTokens: 100_000, maxOutputTokens: 60_000, maxEstimatedCostUsd: 5, maxStagnantIterations: 2 },
        });
        const summary = { canvasId: result.canvas.canvasId, versionId: result.version?.versionId ?? null, stopReason: result.stopReason, awaitingRuntimeVerification: result.awaitingCheckpoint, iterations: result.iterations, diagnostics: result.diagnostics, fallback: result.fallback };
        return { content: [{ type: 'text', text: JSON.stringify(summary) }], isError: result.stopReason === 'blocked' || result.stopReason === 'exhausted', details: { action: args.action, ...summary } };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text', text: message }], isError: true, details: { action: args.action, error: message } };
      }
    },
  };
}
