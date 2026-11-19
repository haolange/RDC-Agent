import type { ChallengeRecord, ClaimRecord, InvestigationReport } from '@shared/types/renderdocInvestigation';
import type { InvestigationArtifactService } from './InvestigationArtifactService';

/** Only challenges against the report's actual claims, source claims, evidence or experiments affect this report. */
export function openReportChallenges(service: InvestigationArtifactService, sessionId: string, report: InvestigationReport): string[] {
  const lookup = service.createLookup(sessionId);
  const claims = new Set<string>();
  const evidence = new Set(report.evidenceIds);
  const experiments = new Set(report.experimentIds);
  const projected = new Map(report.claims.map(claim => [claim.claimId, claim]));
  const pendingClaims: string[] = report.claims.map(claim => claim.claimId);
  const visitedExperiments = new Set<string>();
  while (pendingClaims.length || visitedExperiments.size < experiments.size) {
    while (pendingClaims.length) {
      const id = pendingClaims.pop()!;
      if (claims.has(id)) continue;
      claims.add(id);
      const claim: ClaimRecord | null = projected.get(id) ?? lookup.getClaim(id);
      if (!claim) continue;
      for (const source of claim.compactProvenance ?? []) pendingClaims.push(source.sourceClaimId);
      if (claim.experimentId) experiments.add(claim.experimentId);
    }
    for (const id of experiments) {
      if (visitedExperiments.has(id)) continue;
      visitedExperiments.add(id);
      const experiment = lookup.getExperiment(id);
      if (!experiment) continue;
      pendingClaims.push(experiment.hypothesisClaimId);
      for (const evidenceId of experiment.rollback.verifyEvidenceIds) evidence.add(evidenceId);
    }
  }
  const open: string[] = [];
  for (const entry of service.list(sessionId, { kind: 'challenge' })) {
    if (entry.status !== 'ready' && entry.status !== 'draft') continue;
    const read = service.readRecord(sessionId, entry.artifactId);
    if (read.manifest.status !== 'ready' && read.manifest.status !== 'draft') continue;
    const challenge = read.record as ChallengeRecord;
    const relevant = challenge.targetRef.type === 'claim' ? claims
      : challenge.targetRef.type === 'evidence' ? evidence : experiments;
    if (challenge.status === 'open' && relevant.has(challenge.targetRef.id)) open.push(challenge.challengeId);
  }
  return open;
}
