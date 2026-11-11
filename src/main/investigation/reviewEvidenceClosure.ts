import type {
  ChallengeRecord, ClaimRecord, ClaimSet, EvidencePack, EvidenceRecord, ExperimentRecord, InvestigationReport,
} from '@shared/types/renderdocInvestigation';
import type { InvestigationArtifactService } from './InvestigationArtifactService';

export const REVIEW_CLOSURE_MAX_ADDED_REFS = 64;

export interface ReviewEvidenceClosure {
  /** Granted refs plus the dependencies added by the runtime, in discovery order. */
  refs: string[];
  /** Dependencies that were found but not granted, with the reason. */
  omitted: Array<{ uri: string; reason: 'limit' | 'outside-parent-grant' }>;
}

interface Node { uri: string; kind: string; record: unknown }

/**
 * Follow the investigation records a reviewer was granted to the records and raw artifacts they
 * depend on: claims to their supporting evidence and experiments, evidence to its world state and
 * tool outputs, experiments to their signed execution receipts and verification evidence, and
 * Challenges or reports to what they target. Only existing, active records are followed.
 */
export function reviewEvidenceClosure(
  service: InvestigationArtifactService, ownerSessionId: string, granted: readonly string[],
  canGrant: (uri: string) => boolean = () => true,
): ReviewEvidenceClosure {
  const nodes = new Map<string, Node>();
  const byId = { claim: new Map<string, string[]>(), evidence: new Map<string, string>(), experiment: new Map<string, string>(),
    worldState: new Map<string, string>(), evidenceForClaim: new Map<string, string[]>() };
  const push = <K>(map: Map<K, string[]>, key: K, uri: string) => map.set(key, [...(map.get(key) ?? []), uri]);
  for (const read of service.readAllRecords(ownerSessionId)) {
    if (read.manifest.status !== 'ready' && read.manifest.status !== 'draft') continue;
    const { contentUri: uri, record } = read;
    nodes.set(uri, { uri, kind: read.manifest.kind, record });
    if (read.manifest.kind === 'claim') push(byId.claim, (record as ClaimRecord).claimId, uri);
    if (read.manifest.kind === 'claim_set') for (const item of (record as ClaimSet).items) push(byId.claim, item.claimId, uri);
    const evidenceItems = read.manifest.kind === 'evidence' ? [record as EvidenceRecord]
      : read.manifest.kind === 'evidence_pack' ? (record as EvidencePack).items : [];
    for (const evidence of evidenceItems) {
      byId.evidence.set(evidence.evidenceId, uri);
      for (const claimId of evidence.claimIds) push(byId.evidenceForClaim, claimId, uri);
    }
    if (read.manifest.kind === 'experiment') byId.experiment.set((record as ExperimentRecord).experimentId, uri);
    if (read.manifest.kind === 'world_state') byId.worldState.set((record as { worldStateId: string }).worldStateId, uri);
  }

  const result: string[] = [...new Set(granted)];
  const seen = new Set(result);
  const omitted: ReviewEvidenceClosure['omitted'] = [];
  const queue = [...result];
  let added = 0;
  const visit = (uri: string | undefined) => {
    if (!uri || seen.has(uri)) return;
    seen.add(uri);
    if (!canGrant(uri)) { omitted.push({ uri, reason: 'outside-parent-grant' }); return; }
    if (added >= REVIEW_CLOSURE_MAX_ADDED_REFS) { omitted.push({ uri, reason: 'limit' }); return; }
    added += 1;
    result.push(uri);
    queue.push(uri);
  };
  const claim = (id: string | null | undefined) => {
    if (!id) return;
    for (const uri of byId.claim.get(id) ?? []) visit(uri);
    for (const uri of byId.evidenceForClaim.get(id) ?? []) visit(uri);
  };
  const followClaim = (item: ClaimRecord) => {
    visit(byId.worldState.get(item.worldStateId));
    if (item.experimentId) visit(byId.experiment.get(item.experimentId));
    for (const source of item.compactProvenance ?? []) claim(source.sourceClaimId);
    for (const uri of byId.evidenceForClaim.get(item.claimId) ?? []) visit(uri);
  };
  while (queue.length) {
    const node = nodes.get(queue.shift()!);
    if (!node) continue;
    switch (node.kind) {
      case 'claim': followClaim(node.record as ClaimRecord); break;
      case 'claim_set': (node.record as ClaimSet).items.forEach(followClaim); break;
      case 'evidence':
      case 'evidence_pack':
        for (const evidence of node.kind === 'evidence' ? [node.record as EvidenceRecord] : (node.record as EvidencePack).items) {
          visit(byId.worldState.get(evidence.worldStateId));
          for (const ref of evidence.artifactRefs) visit(ref.uri);
        }
        break;
      case 'experiment': {
        const experiment = node.record as ExperimentRecord;
        claim(experiment.hypothesisClaimId);
        for (const id of [experiment.baselineWorldStateId, experiment.variantWorldStateId, experiment.restoredWorldStateId]) visit(byId.worldState.get(id));
        for (const ref of Object.values(experiment.executionEvidence ?? {})) visit(ref.uri);
        for (const id of experiment.rollback.verifyEvidenceIds) visit(byId.evidence.get(id));
        break;
      }
      case 'challenge': {
        const target = (node.record as ChallengeRecord).targetRef;
        if (target.type === 'claim') claim(target.id);
        else visit((target.type === 'evidence' ? byId.evidence : byId.experiment).get(target.id));
        break;
      }
      case 'report': {
        const report = node.record as InvestigationReport;
        report.claims.forEach(followClaim);
        for (const id of report.evidenceIds) visit(byId.evidence.get(id));
        for (const id of report.experimentIds) visit(byId.experiment.get(id));
        break;
      }
      default: break;
    }
  }
  return { refs: result, omitted };
}
