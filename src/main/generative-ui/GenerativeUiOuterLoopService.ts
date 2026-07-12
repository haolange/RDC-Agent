import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { AddGenerativeUiOuterEvidenceRequest, GenerativeUiOuterEvidence, GenerativeUiOuterEvidenceKind, GenerativeUiOuterLoopReport } from '@shared/types/generativeUi';
import { appPathService } from '../runtime/AppPathService';
import { generativeUiCanvasService, type GenerativeUiCanvasService } from './GenerativeUiCanvasService';
import { GENERATIVE_UI_BENCHMARK_CASES, GENERATIVE_UI_BENCHMARK_VERSION } from '@shared/constants/generativeUiBenchmark';

const KINDS: GenerativeUiOuterEvidenceKind[] = ['use_case', 'competitor_observation', 'expert_review', 'blind_preference'];

export class GenerativeUiOuterLoopService {
  constructor(
    private readonly rootPath = appPathService.getAppStatePaths().generativeUiEvaluationPath,
    private readonly canvases: GenerativeUiCanvasService = generativeUiCanvasService,
  ) {}

  add(sessionId: string, request: AddGenerativeUiOuterEvidenceRequest): GenerativeUiOuterEvidence {
    const records = this.list(sessionId);
    this.validate(sessionId, request, records);
    const evidence: GenerativeUiOuterEvidence = { evidenceId: randomUUID(), ...request, title: request.title.trim(), source: request.source.trim(),
      notes: request.notes.trim(), staticReference: request.staticReference?.trim(), createdAt: Date.now() };
    records.push(evidence);
    this.write(sessionId, records);
    return evidence;
  }

  list(sessionId: string): GenerativeUiOuterEvidence[] {
    const target = this.filePath(sessionId);
    if (!fs.existsSync(target)) return [];
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8')) as { schemaVersion: 1; records: GenerativeUiOuterEvidence[] };
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.records)) throw new Error('Unsupported Generative UI evaluation evidence schema.');
    return parsed.records.sort((left, right) => right.createdAt - left.createdAt);
  }

  report(sessionId: string): GenerativeUiOuterLoopReport {
    const records = this.list(sessionId);
    const metrics = this.canvases.summarize(sessionId);
    const sessionCanvases = this.canvases.list(sessionId);
    const canvasVersionIsClosed = (record: GenerativeUiOuterEvidence) => {
      const version = sessionCanvases.find((canvas) => canvas.canvasId === record.canvasId)?.versions.find((entry) => entry.versionId === record.versionId);
      return Boolean(version && [1, 2, 3].every((level) => version.verification.some((entry) => entry.level === level && entry.passed)));
    };
    const validUseCases = records.filter((entry) => entry.kind === 'use_case' && canvasVersionIsClosed(entry));
    const validExperts = records.filter((entry) => entry.kind === 'expert_review' && entry.score !== undefined && entry.notes.trim())
      .filter((entry, index, entries) => entries.findIndex((candidate) => candidate.source.trim().toLowerCase() === entry.source.trim().toLowerCase()) === index);
    const counts: Record<GenerativeUiOuterEvidenceKind, number> = {
      use_case: validUseCases.length,
      competitor_observation: records.filter((entry) => entry.kind === 'competitor_observation' && entry.notes.trim()).length,
      expert_review: validExperts.length,
      blind_preference: records.filter((entry) => entry.kind === 'blind_preference').length,
    };
    const blinded = records.filter((entry) => entry.kind === 'blind_preference' && entry.blinded && entry.canvasId && entry.versionId
      && entry.staticReference && entry.outcome && entry.outcome !== 'tie');
    const dynamicPreferred = blinded.filter((entry) => entry.outcome === 'dynamic').length;
    const observedPreferenceRate = blinded.length ? dynamicPreferred / blinded.length : null;
    const benchmarkCanvases = sessionCanvases.filter((canvas) => canvas.benchmarkCaseId);
    const successfulCaseIds = new Set(benchmarkCanvases.filter((canvas) => canvas.stopReason === 'success').map((canvas) => canvas.benchmarkCaseId));
    const categorySuccess = Object.fromEntries(['website', 'dashboard', 'simulator', 'tool', 'visualization', 'game'].map((category) =>
      [category, GENERATIVE_UI_BENCHMARK_CASES.filter((entry) => entry.category === category && successfulCaseIds.has(entry.caseId)).length])) as GenerativeUiOuterLoopReport['benchmark']['categorySuccess'];
    const gaps: string[] = [];
    if (successfulCaseIds.size < GENERATIVE_UI_BENCHMARK_CASES.length) gaps.push(`Need ${GENERATIVE_UI_BENCHMARK_CASES.length - successfulCaseIds.size} more successful canonical benchmark cases.`);
    if (counts.use_case < 5) gaps.push(`Need ${5 - counts.use_case} more documented real use cases.`);
    if (counts.competitor_observation < 1) gaps.push('Need current competitor behavior evidence with source and date.');
    if (counts.expert_review < 3) gaps.push(`Need ${3 - counts.expert_review} more independent expert reviews.`);
    if (blinded.length < 20) gaps.push(`Need ${20 - blinded.length} more valid blinded preference decisions.`);
    if (!metrics.targetStatus.generationSuccessRate) gaps.push('Generation success rate is below 85%.');
    if (!metrics.targetStatus.loopClosureRate) gaps.push('L1/L2/L3 loop closure rate is below 90%.');
    if (metrics.targetStatus.previewReadyLatency !== true) gaps.push('Median measured preview-ready latency is not yet proven at 2 seconds or lower.');
    if (metrics.promptToUsableSampleCount < 1) gaps.push('Prompt-to-usable latency has no persisted L3-closed Canvas sample.');
    if (observedPreferenceRate === null || observedPreferenceRate < 0.65) gaps.push('Blinded dynamic UI preference is not yet proven at 65% or higher.');
    if (metrics.canvasesWithFiveEffectiveIterations < 1) gaps.push('No Canvas has a parent-linked lineage of five L1/L2/L3-closed iterations.');
    const actions = gaps.map((gap) => `Close evidence gap: ${gap}`);
    return { generatedAt: Date.now(), cadence: 'weekly', metrics: { ...metrics, dynamicUiPreferenceRate: observedPreferenceRate,
      targetStatus: { ...metrics.targetStatus, dynamicUiPreferenceRate: observedPreferenceRate === null ? null : observedPreferenceRate >= 0.65 } },
      evidenceCounts: counts, benchmark: { version: GENERATIVE_UI_BENCHMARK_VERSION, caseCount: GENERATIVE_UI_BENCHMARK_CASES.length,
        attemptedCaseCount: new Set(benchmarkCanvases.map((canvas) => canvas.benchmarkCaseId)).size, successfulCaseCount: successfulCaseIds.size, categorySuccess },
      gaps, actions, decision: gaps.length === 0 ? 'v1_ready' : 'continue' };
  }

  private validate(sessionId: string, request: AddGenerativeUiOuterEvidenceRequest, records: GenerativeUiOuterEvidence[]): void {
    if (!KINDS.includes(request.kind)) throw new Error('Unknown Outer Loop evidence kind.');
    if (!request.title.trim() || !request.source.trim()) throw new Error('Evidence title and source are required.');
    if (request.notes.length > 20_000) throw new Error('Evidence notes exceed 20,000 characters.');
    if (request.kind === 'use_case') {
      const canvas = request.canvasId ? this.canvases.get(sessionId, request.canvasId) : null;
      const version = canvas?.versions.find((entry) => entry.versionId === request.versionId);
      if (!version || ![1, 2, 3].every((level) => version.verification.some((entry) => entry.level === level && entry.passed))) {
        throw new Error('Real use case evidence requires a Canvas/version with passing Levels 1, 2, and 3.');
      }
    }
    if (request.kind === 'expert_review') {
      if (request.score === undefined || !request.notes.trim()) throw new Error('Expert review evidence requires a score and review notes.');
      if (records.some((entry) => entry.kind === 'expert_review' && entry.source.trim().toLowerCase() === request.source.trim().toLowerCase())) {
        throw new Error('An expert review from this reviewer source is already recorded.');
      }
    }
    if (request.kind === 'competitor_observation' && !request.notes.trim()) throw new Error('Competitor observation requires dated observation notes.');
    if (request.kind === 'blind_preference') {
      if (!request.blinded || !request.candidateOrder || !['dynamic', 'static', 'tie'].includes(request.outcome ?? '')
        || !request.canvasId || !request.versionId || !request.staticReference?.trim()) {
        throw new Error('Blind preference evidence requires blinded=true, randomized candidateOrder, a dynamic/static/tie outcome, a Canvas/version, and a static baseline reference.');
      }
      const canvas = this.canvases.get(sessionId, request.canvasId);
      const version = canvas?.versions.find((entry) => entry.versionId === request.versionId);
      if (!version || ![1, 2, 3].every((level) => version.verification.some((entry) => entry.level === level && entry.passed))) {
        throw new Error('Blind preference requires a dynamic Canvas/version with passing Levels 1, 2, and 3.');
      }
      const duplicate = records.some((entry) => entry.kind === 'blind_preference' && entry.source === request.source.trim()
        && entry.canvasId === request.canvasId && entry.versionId === request.versionId && entry.staticReference === request.staticReference?.trim());
      if (duplicate) throw new Error('This blind panel decision for the same dynamic and static artifacts is already recorded.');
    }
    if (request.score !== undefined && (!Number.isFinite(request.score) || request.score < 0 || request.score > 100)) throw new Error('Evidence score must be between 0 and 100.');
  }

  private filePath(sessionId: string): string { return path.join(this.rootPath, `${sessionId.replace(/[^a-zA-Z0-9_-]/g, '-')}.json`); }
  private write(sessionId: string, records: GenerativeUiOuterEvidence[]): void {
    fs.mkdirSync(this.rootPath, { recursive: true });
    const target = this.filePath(sessionId);
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify({ schemaVersion: 1, records }, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, target);
  }
}

export const generativeUiOuterLoopService = new GenerativeUiOuterLoopService();
