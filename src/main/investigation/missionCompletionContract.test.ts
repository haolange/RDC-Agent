import { describe, expect, it } from 'vitest';
import {
  assertMissionTurnCompletion,
  enforceMissionTurnCompletion,
  finalAnswerCitesReport,
  isAllowedMissionCompletionStatus,
  MissionCompletionError,
  reportStatusForbidsCompleted,
} from './missionCompletionContract';
import {
  SESSION_ID,
  baselineWorld,
  createInvestigationHarness,
  derivedStructureClaim,
  evidenceOf,
  exclusiveWorld,
  hypothesisClaim,
  observedClaim,
  projectClaim,
  recordedExperiment,
  sampleCheckpoint,
  sampleReportContract,
  seedNote,
  writeDraft,
  writeReadyReport,
} from './investigationTestFixtures';

const MISSIONS = ['debugger', 'analyzer', 'optimizer'] as const;

function seedCheckpoint(service: ReturnType<typeof createInvestigationHarness>['service'], mission: typeof MISSIONS[number]) {
  writeDraft(service, 'world_state', baselineWorld('ws-baseline'), { mission });
  return writeDraft(service, 'checkpoint', sampleCheckpoint({
    checkpointId: `cp-${mission}`,
    currentWorldStateId: 'ws-baseline',
  }), { mission });
}

function seedHypothesis(service: ReturnType<typeof createInvestigationHarness>['service'], mission: typeof MISSIONS[number]) {
  return writeDraft(service, 'claim', hypothesisClaim('ws-baseline', `claim-${mission}`), { mission });
}

describe('missionCompletionContract', () => {
  it('does not constrain General', () => {
    expect(enforceMissionTurnCompletion({
      profileId: 'general',
      sessionId: SESSION_ID,
      finalAnswerText: 'done without artifacts',
    })).toBeUndefined();
    expect(() => enforceMissionTurnCompletion({
      profileId: 'general',
      sessionId: null,
      finalAnswerText: '',
    })).not.toThrow();
  });

  it.each(MISSIONS)('%s cannot complete without a report', (mission) => {
    const { service } = createInvestigationHarness();
    seedCheckpoint(service, mission);
    expect(() => assertMissionTurnCompletion({
      profileId: mission,
      sessionId: SESSION_ID,
      finalAnswerText: 'Mission finished in prose only.',
      service,
    })).toThrow(MissionCompletionError);
    try {
      assertMissionTurnCompletion({
        profileId: mission,
        sessionId: SESSION_ID,
        finalAnswerText: 'Mission finished in prose only.',
        service,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(MissionCompletionError);
      expect((error as MissionCompletionError).code).toBe('MISSION_COMPLETION_DENIED');
      expect((error as MissionCompletionError).reason).toBe('missing_report');
    }
  });

  it.each(MISSIONS)('%s cannot complete without a checkpoint', (mission) => {
    const { service } = createInvestigationHarness();
    writeDraft(service, 'world_state', baselineWorld('ws-baseline'), { mission });
    const claim = seedHypothesis(service, mission);
    const report = writeReadyReport(service, {
      mission,
      source: claim,
      claims: [projectClaim(claim.record as never, `claim-${mission}-proj`)],
    });
    const finalAnswer = `See ${report.manifest.artifactId} ${report.contentHash}`;
    expect(() => assertMissionTurnCompletion({
      profileId: mission,
      sessionId: SESSION_ID,
      finalAnswerText: finalAnswer,
      service,
    })).toThrow(/missing_checkpoint|MISSION_COMPLETION_DENIED/);
    try {
      assertMissionTurnCompletion({
        profileId: mission,
        sessionId: SESSION_ID,
        finalAnswerText: finalAnswer,
        service,
      });
    } catch (error) {
      expect((error as MissionCompletionError).reason).toBe('missing_checkpoint');
    }
  });

  it.each(MISSIONS)('%s final and report are bidirectional', { timeout: 15_000 }, (mission) => {
    const { resolver, service } = createInvestigationHarness();
    seedCheckpoint(service, mission);
    const extras = seedMissionMethod(service, resolver, mission);
    const claim = extras.claim;
    const report = writeReadyReport(service, {
      mission,
      source: claim,
      claims: extras.claims,
      evidenceIds: extras.evidenceIds,
      experimentIds: extras.experimentIds,
    });
    expect(() => assertMissionTurnCompletion({
      profileId: mission,
      sessionId: SESSION_ID,
      finalAnswerText: 'I registered report.md via output_register.',
      service,
    })).toThrow(/final_not_bound|MISSION_COMPLETION_DENIED/);
    const finalAnswer = `Canonical final cites ${report.manifest.artifactId} at ${report.contentHash}.`;
    expect(finalAnswerCitesReport(finalAnswer, report.manifest.artifactId, report.contentHash)).toBe(true);
    const receipt = assertMissionTurnCompletion({
      profileId: mission,
      sessionId: SESSION_ID,
      finalAnswerText: finalAnswer,
      service,
    });
    expect(receipt.reportArtifactId).toBe(report.manifest.artifactId);
    expect(receipt.reportContentHash).toBe(report.contentHash);
    expect(receipt.checkpointId).toBe(`cp-${mission}`);
  });

  it('allows only the closed success status set', { timeout: 15_000 }, () => {
    for (const allowed of ['verified', 'VERIFIED', 'conclusive', 'Complete', 'complete']) {
      expect(isAllowedMissionCompletionStatus(allowed)).toBe(true);
      expect(reportStatusForbidsCompleted(allowed)).toBe(false);
    }
    for (const denied of ['Partial', 'Inconclusive', 'Blocked', 'Pending', 'Failed', 'Unknown', 'Partially', 'done', 'almost complete', '']) {
      expect(isAllowedMissionCompletionStatus(denied)).toBe(false);
      expect(reportStatusForbidsCompleted(denied)).toBe(true);
    }
    const { service } = createInvestigationHarness();
    seedCheckpoint(service, 'debugger');
    const claim = seedHypothesis(service, 'debugger');
    const report = writeReadyReport(service, {
      mission: 'debugger',
      source: claim,
      claims: [projectClaim(claim.record as never, 'claim-status-pending')],
      reportContract: sampleReportContract([claim.manifest.artifactId], { status: 'Pending' }),
    });
    expect(() => assertMissionTurnCompletion({
      profileId: 'debugger',
      sessionId: SESSION_ID,
      finalAnswerText: `${report.manifest.artifactId} ${report.contentHash}`,
      service,
    })).toThrow(/non_complete_status|MISSION_COMPLETION_DENIED/);
  });

  it('refuses Analyzer completion when any explanation layer is missing', () => {
    const { service } = createInvestigationHarness();
    seedCheckpoint(service, 'analyzer');
    const observed = writeDraft(service, 'claim', observedClaim('ws-baseline', 'claim-analyzer-obs'), { mission: 'analyzer' });
    const report = writeReadyReport(service, {
      mission: 'analyzer',
      source: observed,
      claims: [projectClaim(observed.record as never, 'claim-analyzer-obs-proj')],
    });
    expect(() => assertMissionTurnCompletion({
      profileId: 'analyzer',
      sessionId: SESSION_ID,
      finalAnswerText: `${report.manifest.artifactId} ${report.contentHash}`,
      service,
    })).toThrow(/mission_method|Reconstructed|Authoring|MISSION_COMPLETION_DENIED/);
  });

  it('skips the completion contract while a durable handoff is pending', () => {
    const { service } = createInvestigationHarness();
    expect(enforceMissionTurnCompletion({
      profileId: 'debugger',
      sessionId: SESSION_ID,
      finalAnswerText: 'handing off',
      pendingHandoff: true,
      service,
    })).toBeUndefined();
  });
});

function seedMissionMethod(
  service: ReturnType<typeof createInvestigationHarness>['service'],
  resolver: ReturnType<typeof createInvestigationHarness>['resolver'],
  mission: typeof MISSIONS[number],
) {
  if (mission === 'analyzer') {
    const observed = writeDraft(service, 'claim', observedClaim('ws-baseline', 'claim-analyzer'), { mission });
    const reconstructed = writeDraft(service, 'claim', derivedStructureClaim('ws-baseline', 'claim-analyzer-recon'), { mission });
    const authoring = writeDraft(service, 'claim', hypothesisClaim('ws-baseline', 'claim-analyzer-auth'), { mission });
    return {
      claim: observed,
      claims: [
        projectClaim(observed.record as never, 'claim-analyzer-obs-proj'),
        projectClaim(reconstructed.record as never, 'claim-analyzer-recon-proj'),
        projectClaim(authoring.record as never, 'claim-analyzer-auth-proj'),
      ],
      evidenceIds: [],
      experimentIds: [],
    };
  }
  const claim = writeDraft(service, 'claim', hypothesisClaim('ws-baseline', `claim-${mission}`), { mission });
  if (mission !== 'optimizer') {
    return {
      claim,
      claims: [projectClaim(claim.record as never, `claim-${mission}-proj`)],
      evidenceIds: [],
      experimentIds: [],
    };
  }
  const note = seedNote(resolver);
  writeDraft(service, 'world_state', exclusiveWorld('ws-var'), { mission });
  writeDraft(service, 'world_state', baselineWorld('ws-restored'), { mission });
  writeDraft(service, 'evidence', { ...evidenceOf('ws-restored', note, 'ev-verify'), mission: 'optimizer' }, { mission });
  writeDraft(service, 'experiment', recordedExperiment({
    experimentId: 'exp-opt',
    hypothesisClaimId: `claim-${mission}`,
    baselineWorldStateId: 'ws-baseline',
    variantWorldStateId: 'ws-var',
    restoredWorldStateId: 'ws-restored',
    verifyEvidenceIds: ['ev-verify'],
    protocolKind: 'A-B-A',
  }), { mission });
  return {
    claim,
    claims: [projectClaim(claim.record as never, `claim-${mission}-proj`)],
    evidenceIds: ['ev-verify'],
    experimentIds: ['exp-opt'],
  };
}
