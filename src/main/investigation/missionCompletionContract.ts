import { allowsBudgetPause } from './missionBudgetPause';
import { storageAdapter } from '../sessions/StorageAdapter';
import { enforceTaskReturnBinding, type TurnCompletionInput } from '../agent-runtime/agent/TurnCompletionValidator';
import { isMissionAgentId } from '@shared/types/agent';
import {
  ANALYZER_EXPLANATION_LAYERS,
  analyzerExplanationLayer,
  type AnalyzerExplanationLayer,
  type InvestigationMission,
  type InvestigationReport,
  type MissionCheckpoint,
} from '@shared/types/renderdocInvestigation';
import { InvestigationArtifactService, investigationArtifactService } from './InvestigationArtifactService';
import type { InvestigationReadResult } from './investigationArtifactWrite';
import { InvestigationError } from './investigationErrors';
import { assertOptimizerExperimentClose, assertReportContractPresent } from './investigationInvariants';

export const MISSION_COMPLETION_DENIED = 'MISSION_COMPLETION_DENIED';

export type MissionCompletionDenialReason =
  | 'missing_checkpoint'
  | 'missing_report'
  | 'report_not_ready'
  | 'incomplete_chapters'
  | 'final_not_bound'
  | 'non_complete_status'
  | 'mission_method';

export class MissionCompletionError extends Error {
  readonly code = MISSION_COMPLETION_DENIED;
  readonly reason: MissionCompletionDenialReason;
  readonly details?: Record<string, unknown>;

  constructor(
    reason: MissionCompletionDenialReason,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(`${MISSION_COMPLETION_DENIED}: ${message}`);
    this.name = 'MissionCompletionError';
    this.reason = reason;
    this.details = details;
  }
}

export function isMissionCompletionError(error: unknown): error is MissionCompletionError {
  return error instanceof MissionCompletionError;
}

export const MISSION_COMPLETION_STATUS_VALUES = ['verified', 'conclusive', 'complete'] as const;

export function isAllowedMissionCompletionStatus(statusChapter: string): boolean {
  const normalized = statusChapter.trim().toLowerCase();
  return (MISSION_COMPLETION_STATUS_VALUES as readonly string[]).includes(normalized);
}

export function reportStatusForbidsCompleted(statusChapter: string): boolean {
  return !isAllowedMissionCompletionStatus(statusChapter);
}

export function finalAnswerCitesReport(text: string, artifactId: string, contentHash: string): boolean {
  return text.includes(artifactId) && text.includes(contentHash);
}

export interface MissionCompletionInput extends TurnCompletionInput {
  profileId: string;
  turnId?: string;
  sessionId?: string | null;
  finalAnswerText: string;
  pendingHandoff?: boolean;
  pendingHandoffTarget?: string;
  service?: InvestigationArtifactService;
}

export interface MissionCompletionReceipt {
  checkpointId: string;
  checkpointArtifactId: string;
  reportArtifactId: string;
  reportContentHash: string;
}

export function enforceMissionTurnCompletion(input: MissionCompletionInput): MissionCompletionReceipt | void {
  if (input.taskBinding) {
    const binding = input.taskBinding;
    const pending = input.sessionId ? storageAdapter.handoffs.getActive(input.sessionId) : null;
    enforceTaskReturnBinding(input, pending);
    if (binding.validationPolicy === 'renderdoc-investigation' && pending?.contract.intent === 'return') {
      const service = input.service ?? investigationArtifactService;
      const checkpoint = resolveMissionCheckpoint(service, input.sessionId!, binding.returnTo as InvestigationMission);
      if (!checkpoint || Date.parse(checkpoint.manifest.createdAt) < binding.dispatchedAt || !pending.contract.artifacts.some(ref => ref.uri === checkpoint.contentUri && ref.hash.replace(/^sha256:/, '') === checkpoint.contentHash.replace(/^sha256:/, ''))) {
        throw new MissionCompletionError('missing_checkpoint', 'Return must include the updated domain Checkpoint URI and hash.');
      }
    }
  }
  if (!isMissionAgentId(input.profileId)) return;
  if (input.pendingHandoff) return;
  // Ending a conversational reply does not declare the investigation complete.
  // Task return bindings above remain mandatory even for ordinary replies.
  if (!input.disposition) return;
  if (input.disposition === 'partial' || input.disposition === 'blocked' || input.disposition === 'cancelled') return;
  if (allowsBudgetPause(input, input.service ?? investigationArtifactService)) return;
  return assertMissionTurnCompletion(input);
}

export function assertMissionTurnCompletion(input: MissionCompletionInput): MissionCompletionReceipt {
  const mission = input.profileId;
  if (!isMissionAgentId(mission)) {
    throw new MissionCompletionError('mission_method', `profile ${mission} is not a Mission profile`);
  }
  const sessionId = input.sessionId?.trim();
  if (!sessionId) {
    throw new MissionCompletionError('missing_report', 'Mission completion requires a session-owned investigation store');
  }
  const service = input.service ?? investigationArtifactService;
  const finalAnswer = input.finalAnswerText ?? '';

  let checkpoint: InvestigationReadResult | null;
  try {
    checkpoint = resolveMissionCheckpoint(service, sessionId, mission);
  } catch (error) {
    if (error instanceof InvestigationError && error.code === 'INVESTIGATION_SESSION_DENIED') {
      checkpoint = null;
    } else {
      throw error;
    }
  }
  if (!checkpoint) {
    throw new MissionCompletionError(
      'missing_checkpoint',
      `${mission} cannot complete without a dereferenceable MissionCheckpoint`,
      { mission },
    );
  }

  let readyReports: InvestigationReadResult[];
  try {
    readyReports = listReadyMissionReports(service, sessionId, mission);
  } catch (error) {
    if (error instanceof InvestigationError && error.code === 'INVESTIGATION_SESSION_DENIED') {
      readyReports = [];
    } else {
      throw error;
    }
  }
  if (readyReports.length < 1) {
    throw new MissionCompletionError(
      'missing_report',
      `${mission} cannot complete without a ready kind=report artifact`,
      { mission },
    );
  }

  const cited = readyReports.filter((entry) => (
    finalAnswerCitesReport(finalAnswer, entry.manifest.artifactId, entry.contentHash)
  ));
  if (cited.length < 1) {
    throw new MissionCompletionError(
      'final_not_bound',
      'canonical final_answer must cite the ready report artifactId and contentHash',
      {
        mission,
        reportArtifactIds: readyReports.map((entry) => entry.manifest.artifactId),
      },
    );
  }

  const report = cited[cited.length - 1]!;
  if (report.manifest.status !== 'ready' || report.manifest.kind !== 'report') {
    throw new MissionCompletionError(
      'report_not_ready',
      'cited report must be kind=report and status=ready',
      { artifactId: report.manifest.artifactId, status: report.manifest.status },
    );
  }

  const body = report.record as InvestigationReport;
  try {
    assertReportContractPresent(body, service.createLookup(sessionId), { mission });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new MissionCompletionError(
      'incomplete_chapters',
      `ready report is missing required chapters: ${message}`,
      { artifactId: report.manifest.artifactId },
    );
  }

  const statusChapter = body.reportContract?.status ?? '';
  if (reportStatusForbidsCompleted(statusChapter)) {
    throw new MissionCompletionError(
      'non_complete_status',
      `report.status must be one of ${MISSION_COMPLETION_STATUS_VALUES.join('|')}; ${statusChapter || '(empty)'} cannot complete`,
      { status: statusChapter, artifactId: report.manifest.artifactId },
    );
  }

  assertMissionMethodSurface(mission, body, service, sessionId);

  return {
    checkpointId: (checkpoint.record as MissionCheckpoint).checkpointId,
    checkpointArtifactId: checkpoint.manifest.artifactId,
    reportArtifactId: report.manifest.artifactId,
    reportContentHash: report.contentHash,
  };
}

function resolveMissionCheckpoint(
  service: InvestigationArtifactService,
  sessionId: string,
  mission: InvestigationMission,
): InvestigationReadResult | null {
  const entries = service.list(sessionId, { kind: 'checkpoint' });
  const resolved: InvestigationReadResult[] = [];
  for (const entry of entries) {
    try {
      const result = service.readRecord(sessionId, entry.artifactId);
      if (result.manifest.mission !== mission) continue;
      const record = result.record as MissionCheckpoint;
      if (!record.checkpointId?.trim()) continue;
      resolved.push(result);
    } catch (error) {
      if (error instanceof InvestigationError && error.code === 'INVESTIGATION_NOT_FOUND') continue;
      throw error;
    }
  }
  return resolved.at(-1) ?? null;
}

function listReadyMissionReports(
  service: InvestigationArtifactService,
  sessionId: string,
  mission: InvestigationMission,
): InvestigationReadResult[] {
  const entries = service.list(sessionId, { kind: 'report', status: 'ready' });
  const resolved: InvestigationReadResult[] = [];
  for (const entry of entries) {
    const result = service.readRecord(sessionId, entry.artifactId);
    if (result.manifest.mission !== mission) continue;
    if (result.manifest.kind !== 'report' || result.manifest.status !== 'ready') continue;
    resolved.push(result);
  }
  return resolved;
}

function assertMissionMethodSurface(
  mission: InvestigationMission,
  report: InvestigationReport,
  service: InvestigationArtifactService,
  sessionId: string,
): void {
  for (const id of report.experimentIds) {
    const experiment = service.createLookup(sessionId).getExperiment(id);
    if (experiment) service.assertExecutionEvidence(sessionId, experiment);
  }
  if (mission === 'analyzer') {
    const present = new Set<AnalyzerExplanationLayer>();
    for (const claim of report.claims) {
      const layer = analyzerExplanationLayer(claim.claimKind);
      if (layer) present.add(layer);
    }
    const missing = ANALYZER_EXPLANATION_LAYERS.filter((layer) => !present.has(layer));
    if (missing.length > 0) {
      throw new MissionCompletionError(
        'mission_method',
        `Analyzer completion requires Observed / Reconstructed / Authoring layers; missing ${missing.join(', ')}`,
        { missing },
      );
    }
    return;
  }
  if (mission === 'optimizer') {
    if (report.experimentIds.length < 1) {
      throw new MissionCompletionError(
        'mission_method',
        'Optimizer completion requires a falsifiable A-B-A experiment with rollback',
      );
    }
    const lookup = service.createLookup(sessionId);
    for (const experimentId of report.experimentIds) {
      const experiment = lookup.getExperiment(experimentId);
      if (!experiment) {
        throw new MissionCompletionError(
          'mission_method',
          `Optimizer experiment ${experimentId} is not dereferenceable`,
          { experimentId },
        );
      }
      try {
        assertOptimizerExperimentClose(experiment, 'optimizer');
      } catch (error) {
        throw new MissionCompletionError(
          'mission_method',
          error instanceof Error ? error.message : String(error),
          { experimentId },
        );
      }
    }
  }
}
