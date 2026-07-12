import type { GenerativeUiCanvas, GenerativeUiRuntimeEventDetails, GenerativeUiRuntimeEventType } from '@shared/types/generativeUi';
import { GenerativeUiCanvasService, generativeUiCanvasService } from './GenerativeUiCanvasService';
import { GenerativeUiInnerLoop } from './GenerativeUiInnerLoop';
import type { GenerativeUiGenerator, GenerativeUiPlanner, GenerativeUiReflector } from './GenerativeUiModelContracts';
import { LlmGenerativeUiModel } from './LlmGenerativeUiModel';

export class GenerativeUiRuntimeContinuation {
  private readonly model: GenerativeUiPlanner & GenerativeUiGenerator & GenerativeUiReflector;
  private readonly loop: GenerativeUiInnerLoop;

  constructor(private readonly canvases: GenerativeUiCanvasService = generativeUiCanvasService, model: GenerativeUiPlanner & GenerativeUiGenerator & GenerativeUiReflector = new LlmGenerativeUiModel()) {
    this.model = model;
    this.loop = new GenerativeUiInnerLoop(model, model, model, canvases);
  }

  async observe(sessionId: string, canvasId: string, versionId: string, eventType: GenerativeUiRuntimeEventType, details?: GenerativeUiRuntimeEventDetails): Promise<GenerativeUiCanvas> {
    let canvas = this.canvases.recordObservation(sessionId, canvasId, versionId, eventType, details);
    const version = canvas.versions.find((entry) => entry.versionId === versionId);
    if (!version || version.runtimePolicy !== 'automatic' || version.runtimeDecision !== 'pending') return canvas;
    const runtime = version.verification.find((entry) => entry.level === 3);
    const terminalFailure = runtime?.checks.some((entry) => !entry.passed) ?? false;
    if (!runtime || (!runtime.passed && !terminalFailure)) return canvas;

    canvas = this.canvases.setRuntimeDecision(sessionId, canvasId, versionId, 'processing', 'Runtime reflection is in progress.');
    try {
      const reflected = await this.model.reflect(version.spec, version.source, version.verification, {
        sessionId, turnId: `generative-ui:${canvasId}:${version.branchId}`, phase: 'runtime-reflect',
      });
      if (runtime.passed && !reflected.shouldContinue) {
        this.canvases.setRuntimeDecision(sessionId, canvasId, versionId, 'success', reflected.reflection, reflected.usage);
        return this.canvases.stop(sessionId, canvasId, 'success');
      }
      const branchIterations = canvas.versions.filter((entry) => entry.branchId === version.branchId).length;
      if (branchIterations >= 5) {
        this.canvases.setRuntimeDecision(sessionId, canvasId, versionId, 'blocked', reflected.reflection, reflected.usage);
        return this.canvases.stop(sessionId, canvasId, 'exhausted');
      }
      this.canvases.setRuntimeDecision(sessionId, canvasId, versionId, 'continue', reflected.reflection, reflected.usage);
      const result = await this.loop.run({ projectId: canvas.projectId, sessionId, canvasId, branchId: version.branchId,
        prompt: version.prompt, checkpoint: 'automatic', budget: { maxIterations: 5 - branchIterations, maxTotalMs: 120_000,
          maxInputTokens: 80_000, maxOutputTokens: 40_000, maxEstimatedCostUsd: 5, maxStagnantIterations: 2 } });
      return result.canvas;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.canvases.setRuntimeDecision(sessionId, canvasId, versionId, 'blocked', message);
      return this.canvases.stop(sessionId, canvasId, 'blocked');
    }
  }
}

export const generativeUiRuntimeContinuation = new GenerativeUiRuntimeContinuation();
