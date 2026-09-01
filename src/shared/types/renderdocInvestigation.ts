/**
 * Vertical Session Artifact schema for RenderDoc investigation.
 * Namespace `rdc.investigation.v1` — Session Artifact only.
 * Do not write these fields into TaskRecord / AgentProfile / ConversationMessage.
 */

export const INVESTIGATION_SCHEMA_NAMESPACE = 'rdc.investigation.v1' as const;

export const INVESTIGATION_MISSIONS = ['debugger', 'analyzer', 'optimizer'] as const;
export type InvestigationMission = (typeof INVESTIGATION_MISSIONS)[number];

export const EPISTEMIC_STATUSES = ['unknown', 'inferred', 'derived', 'observed'] as const;
export type EpistemicStatus = (typeof EPISTEMIC_STATUSES)[number];

/** Epistemic partial order: unknown < inferred < derived < observed. */
export const EPISTEMIC_RANK: Record<EpistemicStatus, number> = {
  unknown: 0,
  inferred: 1,
  derived: 2,
  observed: 3,
};

export function epistemicRank(status: EpistemicStatus): number {
  return EPISTEMIC_RANK[status];
}

export const CONFIDENCE_LEVELS = ['exact', 'strong', 'probable', 'speculative'] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const VERIFICATION_LEVELS = [
  'observed',
  'reconstructed',
  'differential_supported',
  'replay_counterfactual',
  'runtime_counterfactual',
  'cross_scene',
  'cross_device',
  'expert_reviewed',
] as const;
export type VerificationLevel = (typeof VERIFICATION_LEVELS)[number];

export const WORLD_STATE_KINDS = ['baseline', 'experiment', 'restored_baseline', 'unknown'] as const;
export type WorldStateKind = (typeof WORLD_STATE_KINDS)[number];

export const WORLD_STATE_VALIDITIES = ['valid', 'stale', 'polluted', 'unknown'] as const;
export type WorldStateValidity = (typeof WORLD_STATE_VALIDITIES)[number];

export const CLAIM_KINDS = [
  'observed_fact',
  'derived_structure',
  'semantic_inference',
  'hypothesis',
  'causal_conclusion',
  'optimization_recommendation',
  'limitation',
] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

export const CLAIM_PROJECTION_KINDS = ['compact', 'report', 'view'] as const;
export type ClaimProjectionKind = (typeof CLAIM_PROJECTION_KINDS)[number];

export const CLAIM_DECISIONS = ['accept', 'reject', 'downgrade', 'defer'] as const;
export type ClaimDecisionVerdict = (typeof CLAIM_DECISIONS)[number];

export const EXPERIMENT_STATUSES = [
  'designed',
  'running',
  'recorded',
  'rolled_back',
  'failed',
  'aborted',
  'polluted',
] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];

export const EXPERIMENT_PROTOCOLS = ['A-B-A', 'ABABAB'] as const;
export type ExperimentProtocolKind = (typeof EXPERIMENT_PROTOCOLS)[number];

export const EXPERIMENT_ACTION_CLASSES = ['C', 'R', 'E'] as const;
export type ExperimentActionClass = (typeof EXPERIMENT_ACTION_CLASSES)[number];

export const CHALLENGE_TARGET_TYPES = ['claim', 'evidence', 'experiment'] as const;
export type ChallengeTargetType = (typeof CHALLENGE_TARGET_TYPES)[number];

export const CHALLENGE_KINDS = [
  'contradiction',
  'missing_evidence',
  'alternative',
  'scope',
  'unknown',
  'methodology',
] as const;
export type ChallengeKind = (typeof CHALLENGE_KINDS)[number];

export const CHALLENGE_STATUSES = ['open', 'resolved', 'wont_fix'] as const;
export type ChallengeStatus = (typeof CHALLENGE_STATUSES)[number];

export const INVESTIGATION_ARTIFACT_KINDS = [
  'world_state',
  'evidence',
  'evidence_pack',
  'claim',
  'claim_set',
  'experiment',
  'challenge',
  'checkpoint',
  'report',
] as const;
export type InvestigationArtifactKind = (typeof INVESTIGATION_ARTIFACT_KINDS)[number];

export const INVESTIGATION_ARTIFACT_STATUSES = [
  'draft',
  'ready',
  'stale',
  'failed',
  'superseded',
] as const;
export type InvestigationArtifactStatus = (typeof INVESTIGATION_ARTIFACT_STATUSES)[number];

export const INVESTIGATION_RECORD_TYPES = [
  'WorldState',
  'EvidenceRecord',
  'EvidencePack',
  'ClaimRecord',
  'ClaimSet',
  'ExperimentRecord',
  'ChallengeRecord',
  'MissionCheckpoint',
  'InvestigationReport',
] as const;
export type InvestigationRecordType = (typeof INVESTIGATION_RECORD_TYPES)[number];

export const EVIDENCE_SOURCE_KINDS = ['tool', 'human', 'external_document'] as const;
export type EvidenceSourceKind = (typeof EVIDENCE_SOURCE_KINDS)[number];

export const EVIDENCE_OBSERVATION_KINDS = [
  'image_compare',
  'spirv_slice',
  'timing',
  'pixel_history',
  'mesh',
  'resource',
  'other',
] as const;
export type EvidenceObservationKind = (typeof EVIDENCE_OBSERVATION_KINDS)[number];

export const EVIDENCE_STRENGTHS = ['strong', 'moderate', 'weak', 'none'] as const;
export type EvidenceStrength = (typeof EVIDENCE_STRENGTHS)[number];

export const EVIDENCE_REGION_KINDS = ['pixel', 'event', 'resource'] as const;
export type EvidenceRegionKind = (typeof EVIDENCE_REGION_KINDS)[number];

export interface InvestigationKindRegistryEntry {
  kind: InvestigationArtifactKind;
  recordType: InvestigationRecordType;
  schema: `${typeof INVESTIGATION_SCHEMA_NAMESPACE}.${InvestigationRecordType}`;
}

export const INVESTIGATION_KIND_REGISTRY: readonly InvestigationKindRegistryEntry[] = [
  { kind: 'world_state', recordType: 'WorldState', schema: 'rdc.investigation.v1.WorldState' },
  { kind: 'evidence', recordType: 'EvidenceRecord', schema: 'rdc.investigation.v1.EvidenceRecord' },
  { kind: 'evidence_pack', recordType: 'EvidencePack', schema: 'rdc.investigation.v1.EvidencePack' },
  { kind: 'claim', recordType: 'ClaimRecord', schema: 'rdc.investigation.v1.ClaimRecord' },
  { kind: 'claim_set', recordType: 'ClaimSet', schema: 'rdc.investigation.v1.ClaimSet' },
  { kind: 'experiment', recordType: 'ExperimentRecord', schema: 'rdc.investigation.v1.ExperimentRecord' },
  { kind: 'challenge', recordType: 'ChallengeRecord', schema: 'rdc.investigation.v1.ChallengeRecord' },
  { kind: 'checkpoint', recordType: 'MissionCheckpoint', schema: 'rdc.investigation.v1.MissionCheckpoint' },
  { kind: 'report', recordType: 'InvestigationReport', schema: 'rdc.investigation.v1.InvestigationReport' },
] as const;

const KIND_BY_ID = new Map(INVESTIGATION_KIND_REGISTRY.map((entry) => [entry.kind, entry]));

export function resolveInvestigationKind(kind: string): InvestigationKindRegistryEntry | null {
  return KIND_BY_ID.get(kind as InvestigationArtifactKind) ?? null;
}

export interface WorldStateReplay {
  adapter: string;
  driver: string;
  device: string;
  exclusiveLock: boolean;
}

export interface WorldStateShaderReplacement {
  shaderId: string;
  replacementRef: string;
}

export interface WorldStatePatch {
  patchId: string;
  summary: string;
}

export interface WorldStateFocus {
  event?: string;
  resource?: string;
  pixel?: { x: number; y: number };
  subresource?: string;
}

export interface WorldStateBenchmark {
  warmup: number;
  resolution: string;
  vsync: boolean;
  samplingProtocol: string;
}

export interface WorldState {
  worldStateId: string;
  kind: WorldStateKind;
  captureRef: string;
  replay: WorldStateReplay;
  shaderReplacement: WorldStateShaderReplacement | null;
  patchStack: WorldStatePatch[];
  focus: WorldStateFocus;
  benchmark: WorldStateBenchmark;
  validity: WorldStateValidity;
}

export interface EvidenceSource {
  kind: EvidenceSourceKind;
  name: string;
  parameterFingerprint: string;
}

export interface InvestigationContentRef {
  uri: string;
  expectedHash: string;
}

export interface EvidenceRegion {
  kind: EvidenceRegionKind;
  spec: string;
}

export interface EvidenceRecord {
  evidenceId: string;
  mission: InvestigationMission;
  observationKind: EvidenceObservationKind;
  summary: string;
  epistemicStatus: EpistemicStatus;
  worldStateId: string;
  source: EvidenceSource;
  artifactRefs: InvestigationContentRef[];
  contentHashes: string[];
  taskRef?: string;
  claimIds: string[];
  experimentId?: string | null;
  region?: EvidenceRegion;
  strength: EvidenceStrength;
  stale: boolean;
}

export interface EvidencePack {
  items: EvidenceRecord[];
}

export interface CompactProvenanceEntry {
  sourceClaimId: string;
  sourceEpistemicStatus: EpistemicStatus;
  sourceVerificationLevel: VerificationLevel;
}

export interface InvestigationClaimScope {
  capture?: string;
  eventId?: string;
  resourceId?: string;
  pass?: string;
  device?: string;
  api?: string;
  notes?: string;
}

export interface ClaimRootCause {
  trigger: string;
  faultLocation: string;
  failureMechanism: string;
  propagation: string;
  manifestation: string;
  scope: string;
  counterfactualEvidence: string;
}

export interface ClaimDecision {
  verdict: ClaimDecisionVerdict;
  reason: string;
  challengeId?: string;
}

export interface ClaimRecord {
  claimId: string;
  claimKind: ClaimKind;
  statement: string;
  epistemic: EpistemicStatus;
  confidence: ConfidenceLevel;
  verification: VerificationLevel;
  worldStateId: string;
  experimentId: string | null;
  declaresCounterfactual: boolean;
  supports?: string[];
  contradicts?: string[];
  scope: InvestigationClaimScope;
  rootCause?: ClaimRootCause;
  decision?: ClaimDecision;
  projectionKind: ClaimProjectionKind | null;
  compactProvenance: CompactProvenanceEntry[] | null;
}

export interface ClaimSet {
  items: ClaimRecord[];
}

export interface ExperimentIntervention {
  type: string;
  payload: Record<string, unknown>;
}

export interface ExperimentProtocol {
  kind: ExperimentProtocolKind;
  warmup: number;
  noiseThreshold: number;
}

export interface ExperimentMetric {
  name: string;
  kind: string;
  unit?: string;
}

export interface ExperimentVisualValidation {
  before?: string;
  after?: string;
  diff?: string;
  region?: string;
}

export interface ExperimentResult {
  summary: string;
  accepted: boolean;
}

export interface ExperimentRollback {
  executed: boolean;
  baselineRestored: boolean;
  verifyEvidenceIds: string[];
}

export interface ExperimentRecord {
  experimentId: string;
  hypothesisClaimId: string;
  intervention: ExperimentIntervention;
  baselineWorldStateId: string;
  variantWorldStateId: string;
  restoredWorldStateId: string;
  controlledVariables: string[];
  changedVariables: string[];
  metrics: ExperimentMetric[];
  protocol: ExperimentProtocol;
  visualValidation?: ExperimentVisualValidation;
  result?: ExperimentResult;
  rollback: ExperimentRollback;
  actionClass?: ExperimentActionClass;
  status: ExperimentStatus;
}

export interface ChallengeTargetRef {
  type: ChallengeTargetType;
  id: string;
}

export interface ChallengeRecord {
  challengeId: string;
  targetRef: ChallengeTargetRef;
  challengeKind: ChallengeKind;
  statement: string;
  requiredFollowUp?: string;
  status: ChallengeStatus;
  resolutionClaimId?: string;
}

export interface MissionCheckpoint {
  checkpointId: string;
  goal: string;
  planVersion: string;
  established: string[];
  rejected: string[];
  completedExperiments: string[];
  openChallenges: string[];
  reasonForReplan?: string;
  currentWorldStateId: string;
  criticalArtifactRefs: string[];
  unresolvedFrontier: string;
}

export interface InvestigationReport {
  title: string;
  mission: InvestigationMission;
  summary: string;
  claims: ClaimRecord[];
  evidenceIds: string[];
  experimentIds: string[];
}

export interface ArtifactSourceRef {
  artifactId: string;
  expectedHash: string;
}

export interface InvestigationArtifactManifest {
  artifactId: string;
  mission: InvestigationMission;
  kind: InvestigationArtifactKind;
  status: InvestigationArtifactStatus;
  title: string;
  summary: string;
  contentRef: string;
  sourceRefs: ArtifactSourceRef[];
  contentHash: string;
  recordType: InvestigationRecordType;
  worldStateId?: string;
  supersedes?: string;
  createdAt: string;
}

export type InvestigationRecord =
  | WorldState
  | EvidenceRecord
  | EvidencePack
  | ClaimRecord
  | ClaimSet
  | ExperimentRecord
  | ChallengeRecord
  | MissionCheckpoint
  | InvestigationReport;

export function isCausalOrCounterfactualClaim(claim: Pick<ClaimRecord, 'claimKind' | 'declaresCounterfactual'>): boolean {
  return claim.claimKind === 'causal_conclusion' || claim.declaresCounterfactual === true;
}

export function isWorldStateMutated(state: Pick<WorldState, 'shaderReplacement' | 'patchStack'>): boolean {
  return state.shaderReplacement != null || state.patchStack.length > 0;
}

export function formatInvestigationContentHash(hex: string): string {
  const bare = hex.trim().toLowerCase().replace(/^sha256:/, '');
  return `sha256:${bare}`;
}

export function bareInvestigationHash(value: string): string {
  return value.trim().toLowerCase().replace(/^sha256:/, '');
}
