import type {
  ChallengeRecord,
  ClaimRecord,
  ClaimSet,
  EvidencePack,
  EvidenceRecord,
  ExperimentRecord,
  InvestigationReport,
} from '@shared/types/renderdocInvestigation';
import type { InvestigationArtifactService } from './InvestigationArtifactService';

/** The records a conclusion stands on: its claims (with any embedded copies), evidence and experiments. */
interface ChallengeSeeds {
  claims: readonly ClaimRecord[];
  claimIds: readonly string[];
  evidenceIds: readonly string[];
  experimentIds: readonly string[];
}

export interface OpenChallenge {
  challengeId: string;
  followUp: string;
}

/**
 * Open Challenges against the seeds or anything they rest on: a claim's compacted sources, an experiment's hypothesis
 * and the evidence that verified its rollback. A Challenge elsewhere in the session does not dispute this conclusion.
 */
function openChallengesAgainst(
  service: InvestigationArtifactService,
  sessionId: string,
  seeds: ChallengeSeeds,
): OpenChallenge[] {
  const lookup = service.createLookup(sessionId);
  const claims = new Set<string>();
  const evidence = new Set(seeds.evidenceIds);
  const experiments = new Set(seeds.experimentIds);
  const projected = new Map(seeds.claims.map((claim) => [claim.claimId, claim]));
  const pendingClaims: string[] = [...seeds.claimIds, ...seeds.claims.map((claim) => claim.claimId)];
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
  const open: OpenChallenge[] = [];
  for (const entry of service.list(sessionId, { kind: 'challenge' })) {
    if (entry.status !== 'ready' && entry.status !== 'draft') continue;
    const read = service.readRecord(sessionId, entry.artifactId);
    if (read.manifest.status !== 'ready' && read.manifest.status !== 'draft') continue;
    const challenge = read.record as ChallengeRecord;
    const relevant =
      challenge.targetRef.type === 'claim' ? claims : challenge.targetRef.type === 'evidence' ? evidence : experiments;
    if (challenge.status === 'open' && relevant.has(challenge.targetRef.id))
      open.push({ challengeId: challenge.challengeId, followUp: challenge.requiredFollowUp ?? challenge.statement });
  }
  return open;
}

/** Only challenges against the report's actual claims, source claims, evidence or experiments affect this report. */
export function openReportChallenges(
  service: InvestigationArtifactService,
  sessionId: string,
  report: InvestigationReport,
): string[] {
  return openChallengesAgainst(service, sessionId, {
    claims: report.claims,
    claimIds: [],
    evidenceIds: report.evidenceIds,
    experimentIds: report.experimentIds,
  }).map((challenge) => challenge.challengeId);
}

/**
 * Open Challenges against the investigation records a Task result cites by content URI (its result and evidence
 * references). URIs that name no current investigation record cite nothing a Challenge can target.
 */
export function openChallengesForCitedRecords(
  service: InvestigationArtifactService,
  sessionId: string,
  uris: readonly string[],
): OpenChallenge[] {
  const cited = new Set(uris);
  const entries = service
    .list(sessionId)
    .filter((entry) => cited.has(entry.contentUri) && (entry.status === 'ready' || entry.status === 'draft'));
  if (!entries.length) return [];
  const seeds = {
    claims: [] as ClaimRecord[],
    claimIds: [] as string[],
    evidenceIds: [] as string[],
    experimentIds: [] as string[],
  };
  for (const entry of entries) {
    const record = service.readRecord(sessionId, entry.artifactId).record;
    switch (entry.kind) {
      case 'report': {
        const report = record as InvestigationReport;
        seeds.claims.push(...report.claims);
        seeds.evidenceIds.push(...report.evidenceIds);
        seeds.experimentIds.push(...report.experimentIds);
        break;
      }
      case 'claim':
        seeds.claimIds.push((record as ClaimRecord).claimId);
        break;
      case 'claim_set':
        seeds.claims.push(...(record as ClaimSet).items);
        break;
      case 'evidence':
        seeds.evidenceIds.push((record as EvidenceRecord).evidenceId);
        break;
      case 'evidence_pack':
        seeds.evidenceIds.push(...(record as EvidencePack).items.map((item) => item.evidenceId));
        break;
      case 'experiment':
        seeds.experimentIds.push((record as ExperimentRecord).experimentId);
        break;
      default:
        break;
    }
  }
  return openChallengesAgainst(service, sessionId, seeds);
}
