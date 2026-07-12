import type {
  GenerativeUiIterationMetrics,
  GenerativeUiLoopRequest,
  GenerativeUiLoopResult,
} from "@shared/types/generativeUi";
import { GenerativeUiCanvasService, generativeUiCanvasService } from "./GenerativeUiCanvasService";
import { GenerativeUiVerifier } from "./GenerativeUiVerifier";
import type { GenerativeUiGenerator, GenerativeUiPlanner, GenerativeUiReflector } from './GenerativeUiModelContracts';
import { sumGenerativeUiUsage } from './GenerativeUiModelContracts';

const elapsed = (startedAt: number): number => Date.now() - startedAt;

export class GenerativeUiInnerLoop {
  constructor(
    private readonly planner: GenerativeUiPlanner,
    private readonly generator: GenerativeUiGenerator,
    private readonly reflector: GenerativeUiReflector,
    private readonly canvases: GenerativeUiCanvasService = generativeUiCanvasService,
    private readonly verifier = new GenerativeUiVerifier(),
  ) {}

  async run(request: GenerativeUiLoopRequest): Promise<GenerativeUiLoopResult> {
    const startedAt = Date.now();
    const modelPrompt = request.modelPrompt ?? request.prompt;
    const diagnostics: string[] = [];
    let canvas = request.canvasId
      ? this.canvases.get(request.sessionId, request.canvasId)
        : this.canvases.create(request.projectId, request.sessionId, request.title ?? "Generative UI", request.prompt, request.benchmarkCaseId);
    if (!canvas) throw new Error(`Canvas not found: ${request.canvasId}`);
    const canvasId = canvas.canvasId;
    let branchId = request.branchId ?? canvas.activeBranchId;
    let previous = canvas.versions.find((version) => version.versionId === canvas?.branches.find((branch) => branch.branchId === branchId)?.headVersionId);
    let lastVersion = previous ?? null;
    let iterations = 0;
    let stagnantIterations = 0;
    const callContext = (phase: 'plan' | 'generate' | 'reflect') => ({
      sessionId: request.sessionId, turnId: `generative-ui:${canvasId}:${branchId}`, phase,
      images: phase === 'reflect' ? undefined : request.modelImages,
    });

    try {
      while (iterations < request.budget.maxIterations && elapsed(startedAt) < request.budget.maxTotalMs) {
        iterations += 1;
        const planningStarted = Date.now();
        const planned = await this.planner.plan(modelPrompt, previous ? { spec: previous.spec, reflection: previous.runtimeReflection ?? previous.reflection } : undefined, callContext('plan'));
        if (planned.noOpReason) {
          diagnostics.push(planned.noOpReason);
          canvas = this.canvases.stop(request.sessionId, canvas.canvasId, "no_op");
          return {
            canvas,
            version: lastVersion,
            iterations,
            stopReason: "no_op",
            awaitingCheckpoint: false,
            diagnostics,
            fallback: { kind: "static", message: planned.noOpReason },
          };
        }
        const planningMs = elapsed(planningStarted);
        const generationStarted = Date.now();
        const generated = await this.generator.generate(modelPrompt, planned.spec, previous?.source, callContext('generate'));
        const generationMs = elapsed(generationStarted);
        const verificationStarted = Date.now();
        const verification = [this.verifier.verifyLevel1(generated.source), this.verifier.verifyLevel2(planned.spec, generated.source)];
        const verificationMs = elapsed(verificationStarted);
        const reflected = await this.reflector.reflect(planned.spec, generated.source, verification, callContext('reflect'));
        stagnantIterations = previous && JSON.stringify(previous.source) === JSON.stringify(generated.source) ? stagnantIterations + 1 : 0;
        const usage = sumGenerativeUiUsage([planned.usage, generated.usage, reflected.usage]);
        const metrics: GenerativeUiIterationMetrics = {
          planningMs,
          generationMs,
          renderMs: 0,
          verificationMs,
          ...usage,
        };
        canvas = this.canvases.commit(request.sessionId, {
          canvasId: canvas.canvasId,
          branchId,
          parentVersionId: previous?.versionId ?? null,
          prompt: request.prompt,
          contextReferences: request.contextReferences,
          spec: planned.spec,
          source: generated.source,
          reflection: reflected.reflection,
          runtimePolicy: request.checkpoint === "automatic" ? "automatic" : "human",
          verification,
          metrics,
        });
        lastVersion = canvas.versions.at(-1) ?? null;
        previous = lastVersion ?? undefined;

        const passed = verification.every((result) => result.passed);
        if (request.checkpoint !== "automatic") {
          return {
            canvas,
            version: lastVersion,
            iterations,
            stopReason: passed ? "success" : "exhausted",
            awaitingCheckpoint: true,
            diagnostics,
            fallback: null,
          };
        }
        if (passed && !reflected.shouldContinue) {
          return {
            canvas,
            version: lastVersion,
            iterations,
            stopReason: "success",
            awaitingCheckpoint: true,
            diagnostics,
            fallback: null,
          };
        }
        if (stagnantIterations >= (request.budget.maxStagnantIterations ?? 3)) {
          diagnostics.push("Generated source did not change across consecutive refinement attempts.");
          canvas = this.canvases.stop(request.sessionId, canvas.canvasId, "blocked");
          return {
            canvas,
            version: lastVersion,
            iterations,
            stopReason: "blocked",
            awaitingCheckpoint: false,
            diagnostics,
            fallback: {
              kind: "human",
              message: "Generation stopped after repeated no-progress iterations. Review the latest Canvas version or revise the request.",
            },
          };
        }
        diagnostics.push(
          `Iteration ${iterations}: ${
            verification
              .flatMap((result) => result.checks)
              .filter((entry) => !entry.passed)
              .map((entry) => entry.id)
              .join(", ") || "reflection requested refinement"
          }`,
        );
        if (this.exceedsUsageBudget(canvas, request)) break;
        branchId = canvas.activeBranchId;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      diagnostics.push(message);
      canvas = this.canvases.stop(request.sessionId, canvas.canvasId, "blocked");
      return {
        canvas,
        version: lastVersion,
        iterations,
        stopReason: "blocked",
        awaitingCheckpoint: false,
        diagnostics,
        fallback: {
          kind: "human",
          message: `Generation could not continue: ${message}`,
        },
      };
    }
    canvas = this.canvases.stop(request.sessionId, canvas.canvasId, "exhausted");
    return {
      canvas,
      version: lastVersion,
      iterations,
      stopReason: "exhausted",
      awaitingCheckpoint: false,
      diagnostics,
      fallback: {
        kind: "human",
        message: "Generation reached its iteration, time, token, or cost budget. Review the latest version before continuing.",
      },
    };
  }

  private exceedsUsageBudget(canvas: ReturnType<GenerativeUiCanvasService["create"]>, request: GenerativeUiLoopRequest): boolean {
    const totals = canvas.versions.reduce(
      (value, version) => ({
        input: value.input + (version.metrics.inputTokens ?? 0),
        output: value.output + (version.metrics.outputTokens ?? 0),
        cost: value.cost + (version.metrics.estimatedCostUsd ?? 0),
      }),
      { input: 0, output: 0, cost: 0 },
    );
    return (
      (request.budget.maxInputTokens !== undefined && totals.input >= request.budget.maxInputTokens) ||
      (request.budget.maxOutputTokens !== undefined && totals.output >= request.budget.maxOutputTokens) ||
      (request.budget.maxEstimatedCostUsd !== undefined && totals.cost >= request.budget.maxEstimatedCostUsd)
    );
  }
}
