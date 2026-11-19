import { allowsBudgetPause } from './missionBudgetPause';
import { type TurnCompletionInput } from '../agent-runtime/agent/TurnCompletionValidator';
import {
  type InvestigationMission,
  type InvestigationReport,
  type MissionCheckpoint,
} from '@shared/types/renderdocInvestigation';
import { InvestigationArtifactService, investigationArtifactService } from './InvestigationArtifactService';
import type { InvestigationReadResult } from './investigationArtifactWrite';
import { InvestigationError } from './investigationErrors';
import { hashesEqual } from './investigationHash';
import { assertOptimizerExperimentClose, assertReportContractPresent } from './investigationInvariants';
import { openReportChallenges } from './reportChallengeEligibility';

export const MISSION_COMPLETION_DENIED = 'MISSION_COMPLETION_DENIED';

export type MissionCompletionDenialReason =
  | 'missing_checkpoint'
  | 'missing_report'
  | 'report_not_ready'
  | 'incomplete_chapters'
  | 'report_not_bound'
  | 'missing_final_answer'
  | 'non_complete_status'
  | 'open_challenge'
  | 'budget_evidence'
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

export interface MissionCompletionInput extends TurnCompletionInput {
  service?: InvestigationArtifactService;
}

type MissionReadinessInput = Omit<MissionCompletionInput, 'finalAnswerText'>;

export interface MissionCompletionReceipt {
  checkpointId: string;
  checkpointArtifactId: string;
  reportArtifactId: string;
  reportContentHash: string;
}

function declaredMission(input: MissionReadinessInput): InvestigationMission | null {
  if (input.completionContract === 'final-answer') return null;
  if (input.completionContract === 'investigation-report') {
    if (!input.investigationMission) {
      throw new MissionCompletionError('mission_method', 'investigation-report requires a declared investigation-mission');
    }
    return input.investigationMission;
  }
  return null;
}

export function enforceMissionTurnCompletion(input: MissionCompletionInput): MissionCompletionReceipt | void {
  if (!declaredMission(input)) return;
  if (!input.disposition) return;
  if (input.disposition === 'partial' || input.disposition === 'blocked' || input.disposition === 'cancelled') return;
  if (input.disposition === 'budget_paused') {
    if (allowsBudgetPause(input, input.service ?? investigationArtifactService)) return;
    throw new MissionCompletionError('budget_evidence', 'budget pause requires a current root limit and a referenced current checkpoint with unresolved work.');
  }
  return assertMissionTurnCompletion(input);
}

/** Check the declared report before completion and check it again at the terminal boundary. */
export function enforceMissionTurnReadiness(input: MissionReadinessInput): void {
  if (!declaredMission(input) || input.disposition !== 'completed') return;
  const { mission, sessionId, service, readyReports } = requireMissionCompletionArtifacts(input);
  const report = requireReferencedReport(input, mission, readyReports);
  assertReportEligible(report, mission, service, sessionId);
}

function requireMissionCompletionArtifacts(input: MissionReadinessInput): {
  mission: InvestigationMission;
  sessionId: string;
  service: InvestigationArtifactService;
  checkpoint: InvestigationReadResult;
  readyReports: InvestigationReadResult[];
} {
  const mission = declaredMission(input);
  if (!mission) {
    throw new MissionCompletionError('mission_method', `profile ${input.profileId} is not under an investigation-report contract`);
  }
  const sessionId = input.sessionId?.trim();
  if (!sessionId) {
    throw new MissionCompletionError('missing_report', 'Mission completion requires a session-owned investigation store');
  }
  const service = input.service ?? investigationArtifactService;

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

  return { mission, sessionId, service, checkpoint, readyReports };
}

export function assertMissionTurnCompletion(input: MissionCompletionInput): MissionCompletionReceipt {
  const { mission, sessionId, service, checkpoint, readyReports } = requireMissionCompletionArtifacts(input);
  if (!input.finalAnswerText.trim()) {
    throw new MissionCompletionError('missing_final_answer', 'Mission completion requires a canonical final answer.');
  }
  const report = requireReferencedReport(input, mission, readyReports);
  assertReportEligible(report, mission, service, sessionId);

  return {
    checkpointId: (checkpoint.record as MissionCheckpoint).checkpointId,
    checkpointArtifactId: checkpoint.manifest.artifactId,
    reportArtifactId: report.manifest.artifactId,
    reportContentHash: report.contentHash,
  };
}

function requireReferencedReport(
  input: MissionReadinessInput,
  mission: InvestigationMission,
  readyReports: InvestigationReadResult[],
): InvestigationReadResult {
  const referenced = readyReports.filter(report => (input.evidenceRefs ?? []).some(ref => (
    ref.uri === report.contentUri && hashesEqual(ref.hash, report.contentHash)
  )));
  const report = referenced.at(-1);
  if (report) return report;
  const reportRefs = readyReports.map(entry => `${entry.contentUri} ${entry.contentHash}`);
  throw new MissionCompletionError('report_not_bound',
    `turn_complete evidenceRefs must include the exact URI and contentHash of a current ready report. Ready report references: ${reportRefs.join('; ')}`,
    { mission, reportArtifactIds: readyReports.map(entry => entry.manifest.artifactId) });
}

function assertReportEligible(
  report: InvestigationReadResult,
  mission: InvestigationMission,
  service: InvestigationArtifactService,
  sessionId: string,
): void {
  if (report.manifest.status !== 'ready' || report.manifest.kind !== 'report') {
    throw new MissionCompletionError(
      'report_not_ready',
      'report must be kind=report and status=ready',
      { artifactId: report.manifest.artifactId, status: report.manifest.status },
    );
  }

  const body = report.record as InvestigationReport;
  try {
    assertReportContractPresent(body, service.createLookup(sessionId), { mission });
  } catch (error) {
    if (!(error instanceof InvestigationError)
      || (error.code !== 'INVESTIGATION_INVARIANT_VIOLATION' && error.code !== 'INVESTIGATION_REF_UNRESOLVED')) {
      throw error;
    }
    throw new MissionCompletionError(
      'incomplete_chapters',
      `ready report is missing required chapters: ${error.message}`,
      { artifactId: report.manifest.artifactId },
    );
  }

  const statusChapter = body.reportContract?.status ?? '';
  if (reportStatusForbidsCompleted(statusChapter)) {
    throw new MissionCompletionError(
      'non_complete_status',
      `report.status must be one of ${MISSION_COMPLETION_STATUS_VALUES.join('|')}; ${statusChapter || '(empty)'} cannot complete (artifact ${report.manifest.artifactId})`,
      { status: statusChapter, artifactId: report.manifest.artifactId },
    );
  }

  assertMissionMethodSurface(mission, body, service, sessionId);
  const openChallenges = openReportChallenges(service, sessionId, body);
  if (openChallenges.length) {
    throw new MissionCompletionError('open_challenge', `report ${report.manifest.artifactId} has unresolved relevant Challenges: ${openChallenges.join(', ')}`, { openChallenges });
  }
}

function resolveMissionCheckpoint(
  service: InvestigationArtifactService,
  sessionId: string,
  mission: InvestigationMission,
): InvestigationReadResult | null {
  const entries = service.list(sessionId, { kind: 'checkpoint' });
  const resolved: InvestigationReadResult[] = [];
  for (const entry of entries) {
    if (entry.status !== 'ready' && entry.status !== 'draft') continue;
    try {
      const result = service.readRecord(sessionId, entry.artifactId);
      if (result.manifest.status !== 'ready' && result.manifest.status !== 'draft') continue;
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
