import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type {
  CommitGenerativeUiVersionRequest,
  GenerativeUiBranch,
  GenerativeUiCanvas,
  GenerativeUiStopReason,
  GenerativeUiVersion,
  GenerativeUiRuntimeEventType,
  GenerativeUiEvaluationSummary,
  GenerativeUiRuntimeEventDetails,
} from '@shared/types/generativeUi';
import { appPathService } from '../runtime/AppPathService';
import { summarizeGenerativeUiEvidence } from './GenerativeUiEvidence';
import { exportGenerativeUiVersion } from './GenerativeUiExporter';
import { updateGenerativeUiRuntimeVerification } from './GenerativeUiRuntimeEvidence';
import { GenerativeUiVerifier } from './GenerativeUiVerifier';

const safeSegment = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/g, '-');

export class GenerativeUiCanvasService {
  private readonly verifier = new GenerativeUiVerifier();

  constructor(private readonly rootPath = appPathService.getAppStatePaths().canvasesPath) {}

  create(projectId: string, sessionId: string, title: string, originalPrompt: string, benchmarkCaseId?: string): GenerativeUiCanvas {
    const now = Date.now();
    const mainBranch: GenerativeUiBranch = {
      branchId: randomUUID(),
      name: 'main',
      headVersionId: null,
      createdFromVersionId: null,
      createdAt: now,
    };
    const canvas: GenerativeUiCanvas = {
      schemaVersion: 1,
      canvasId: randomUUID(),
      projectId,
      sessionId,
      title: title.trim() || 'Untitled Canvas',
      originalPrompt,
      benchmarkCaseId,
      activeBranchId: mainBranch.branchId,
      branches: [mainBranch],
      versions: [],
      observations: [],
      feedback: [],
      stopReason: null,
      createdAt: now,
      updatedAt: now,
    };
    this.write(canvas);
    return canvas;
  }
  list(sessionId: string): GenerativeUiCanvas[] {
    const directory = this.sessionPath(sessionId);
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory)
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => this.readFile(path.join(directory, entry)))
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }
  summarize(sessionId?: string): GenerativeUiEvaluationSummary {
    return summarizeGenerativeUiEvidence(sessionId ? this.list(sessionId) : this.listAll());
  }
  get(sessionId: string, canvasId: string): GenerativeUiCanvas | null {
    const filePath = this.canvasPath(sessionId, canvasId);
    return fs.existsSync(filePath) ? this.readFile(filePath) : null;
  }
  commit(sessionId: string, request: CommitGenerativeUiVersionRequest): GenerativeUiCanvas {
    if (request.runtimePolicy !== 'automatic' && request.runtimePolicy !== 'human') throw new Error('Canvas version runtimePolicy must be automatic or human.');
    const canvas = this.requireCanvas(sessionId, request.canvasId);
    const branch = canvas.branches.find((entry) => entry.branchId === request.branchId);
    if (!branch) throw new Error(`Canvas branch not found: ${request.branchId}`);
    if (branch.headVersionId !== request.parentVersionId) {
      throw new Error('Canvas branch head changed; create a branch or refresh before committing.');
    }
    const submittedVerification = request.verification ?? [];
    const verification = submittedVerification.some((entry) => entry.level === 1)
      && submittedVerification.some((entry) => entry.level === 2)
      ? submittedVerification
      : [this.verifier.verifyLevel1(request.source), this.verifier.verifyLevel2(request.spec, request.source),
        ...submittedVerification.filter((entry) => entry.level === 3)];
    const version: GenerativeUiVersion = {
      versionId: randomUUID(),
      parentVersionId: request.parentVersionId,
      branchId: branch.branchId,
      prompt: request.prompt,
      contextReferences: request.contextReferences ?? [],
      spec: request.spec,
      source: request.source,
      reflection: request.reflection ?? null,
      runtimePolicy: request.runtimePolicy,
      runtimeDecision: request.runtimePolicy === 'automatic' ? 'pending' : null,
      runtimeReflection: null,
      verification,
      metrics: request.metrics,
      createdAt: Date.now(),
    };
    branch.headVersionId = version.versionId;
    canvas.versions.push(version);
    canvas.activeBranchId = branch.branchId;
    canvas.stopReason = null;
    canvas.updatedAt = version.createdAt;
    this.write(canvas);
    return canvas;
  }
  createBranch(sessionId: string, canvasId: string, name: string, fromVersionId: string | null): GenerativeUiCanvas {
    const canvas = this.requireCanvas(sessionId, canvasId);
    if (fromVersionId && !canvas.versions.some((version) => version.versionId === fromVersionId)) {
      throw new Error(`Canvas version not found: ${fromVersionId}`);
    }
    const branch: GenerativeUiBranch = {
      branchId: randomUUID(),
      name: name.trim() || `branch-${canvas.branches.length + 1}`,
      headVersionId: fromVersionId,
      createdFromVersionId: fromVersionId,
      createdAt: Date.now(),
    };
    canvas.branches.push(branch);
    canvas.activeBranchId = branch.branchId;
    canvas.updatedAt = branch.createdAt;
    this.write(canvas);
    return canvas;
  }
  switchBranch(sessionId: string, canvasId: string, branchId: string): GenerativeUiCanvas {
    const canvas = this.requireCanvas(sessionId, canvasId);
    if (!canvas.branches.some((branch) => branch.branchId === branchId)) throw new Error(`Canvas branch not found: ${branchId}`);
    canvas.activeBranchId = branchId;
    canvas.updatedAt = Date.now();
    this.write(canvas);
    return canvas;
  }
  stop(sessionId: string, canvasId: string, reason: GenerativeUiStopReason): GenerativeUiCanvas {
    const canvas = this.requireCanvas(sessionId, canvasId);
    if (reason === 'success') {
      const headId = canvas.branches.find((branch) => branch.branchId === canvas.activeBranchId)?.headVersionId;
      const head = canvas.versions.find((version) => version.versionId === headId);
      const passedLevels = new Set(head?.verification.filter((entry) => entry.passed).map((entry) => entry.level));
      if (!head || !([1, 2, 3] as const).every((level) => passedLevels.has(level))) {
        throw new Error('Canvas cannot be completed until the active branch head passes verification Levels 1, 2, and 3.');
      }
    }
    canvas.stopReason = reason;
    canvas.updatedAt = Date.now();
    this.write(canvas);
    return canvas;
  }
  recordObservation(sessionId: string, canvasId: string, versionId: string, eventType: GenerativeUiRuntimeEventType, details?: GenerativeUiRuntimeEventDetails): GenerativeUiCanvas {
    const canvas = this.requireCanvas(sessionId, canvasId);
    const version = canvas.versions.find((entry) => entry.versionId === versionId);
    if (!version) throw new Error(`Canvas version not found: ${versionId}`);
    const observedAt = Date.now();
    if (eventType === 'ready' && Number.isFinite(details?.latencyMs) && !canvas.observations.some((entry) => entry.versionId === versionId && entry.eventType === 'ready')) {
      version.metrics.renderMs = Math.max(0, Math.round(details!.latencyMs!));
    }
    canvas.observations.push({ observationId: randomUUID(), versionId, eventType, ...details, observedAt });
    updateGenerativeUiRuntimeVerification(version, eventType, details);
    if (!version.usableAt && version.verification.find((entry) => entry.level === 3)?.passed) version.usableAt = observedAt;
    canvas.updatedAt = Date.now();
    this.write(canvas);
    return canvas;
  }
  recordFeedback(sessionId: string, canvasId: string, versionId: string, value: { rating: 1 | 2 | 3 | 4 | 5; usable: boolean; preferredOverStatic?: boolean; comment?: string }): GenerativeUiCanvas {
    const canvas = this.requireCanvas(sessionId, canvasId);
    if (!canvas.versions.some((version) => version.versionId === versionId)) throw new Error(`Canvas version not found: ${versionId}`);
    canvas.feedback.push({ feedbackId: randomUUID(), versionId, ...value, createdAt: Date.now() });
    canvas.updatedAt = Date.now();
    this.write(canvas);
    return canvas;
  }
  setRuntimeDecision(sessionId: string, canvasId: string, versionId: string, decision: GenerativeUiVersion['runtimeDecision'], reflection: string, usage?: { inputTokens?: number; outputTokens?: number; estimatedCostUsd?: number }): GenerativeUiCanvas {
    const canvas = this.requireCanvas(sessionId, canvasId);
    const version = canvas.versions.find((entry) => entry.versionId === versionId);
    if (!version) throw new Error(`Canvas version not found: ${versionId}`);
    version.runtimeDecision = decision;
    version.runtimeReflection = reflection;
    version.metrics.inputTokens = (version.metrics.inputTokens ?? 0) + (usage?.inputTokens ?? 0);
    version.metrics.outputTokens = (version.metrics.outputTokens ?? 0) + (usage?.outputTokens ?? 0);
    version.metrics.estimatedCostUsd = (version.metrics.estimatedCostUsd ?? 0) + (usage?.estimatedCostUsd ?? 0);
    canvas.updatedAt = Date.now();
    this.write(canvas);
    return canvas;
  }
  exportVersion(sessionId: string, canvasId: string, versionId: string): { filePath: string; fileName: string } {
    return exportGenerativeUiVersion(this.rootPath, this.requireCanvas(sessionId, canvasId), versionId);
  }
  private requireCanvas(sessionId: string, canvasId: string): GenerativeUiCanvas {
    const canvas = this.get(sessionId, canvasId);
    if (!canvas) throw new Error(`Canvas not found: ${canvasId}`);
    return canvas;
  }
  private listAll(): GenerativeUiCanvas[] {
    if (!fs.existsSync(this.rootPath)) return [];
    return fs.readdirSync(this.rootPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== 'exports')
      .flatMap((entry) => this.list(entry.name));
  }
  private sessionPath(sessionId: string): string {
    return path.join(this.rootPath, safeSegment(sessionId));
  }
  private canvasPath(sessionId: string, canvasId: string): string {
    return path.join(this.sessionPath(sessionId), `${safeSegment(canvasId)}.json`);
  }
  private readFile(filePath: string): GenerativeUiCanvas {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as GenerativeUiCanvas;
    if (parsed.schemaVersion !== 1) throw new Error(`Unsupported Canvas schema: ${String(parsed.schemaVersion)}`);
    parsed.observations ??= [];
    parsed.feedback ??= [];
    return parsed;
  }
  private write(canvas: GenerativeUiCanvas): void {
    const directory = this.sessionPath(canvas.sessionId);
    fs.mkdirSync(directory, { recursive: true });
    const target = this.canvasPath(canvas.sessionId, canvas.canvasId);
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(canvas, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, target);
  }
}
export const generativeUiCanvasService = new GenerativeUiCanvasService();
