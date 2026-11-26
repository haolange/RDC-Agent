/**
 * Vertical Session Artifact schema for RenderDoc investigation.
 * Namespace `rdc.investigation` — Session Artifact only.
 * Do not write these fields into TaskRecord / AgentManifestDefinition / ConversationMessage.
 */

export const INVESTIGATION_MISSIONS = ['debugger', 'analyzer', 'optimizer'] as const;
export type InvestigationMission = (typeof INVESTIGATION_MISSIONS)[number];

export const EPISTEMIC_STATUSES = ['unknown', 'inferred', 'derived', 'observed'] as const;
export type EpistemicStatus = (typeof EPISTEMIC_STATUSES)[number];

export const CONFIDENCE_LEVELS = ['exact', 'strong', 'probable', 'speculative'] as const;
type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

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
type VerificationLevel = (typeof VERIFICATION_LEVELS)[number];

export const WORLD_STATE_KINDS = ['baseline', 'experiment', 'restored_baseline', 'unknown'] as const;
type WorldStateKind = (typeof WORLD_STATE_KINDS)[number];

export const WORLD_STATE_VALIDITIES = ['valid', 'stale', 'polluted', 'unknown'] as const;
type WorldStateValidity = (typeof WORLD_STATE_VALIDITIES)[number];

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
type ClaimProjectionKind = (typeof CLAIM_PROJECTION_KINDS)[number];

export const CLAIM_DECISIONS = ['accept', 'reject', 'downgrade', 'defer'] as const;
type ClaimDecisionVerdict = (typeof CLAIM_DECISIONS)[number];

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
type ExperimentProtocolKind = (typeof EXPERIMENT_PROTOCOLS)[number];

export const EXPERIMENT_ACTION_CLASSES = ['C', 'R', 'E'] as const;
type ExperimentActionClass = (typeof EXPERIMENT_ACTION_CLASSES)[number];

export const CHALLENGE_TARGET_TYPES = ['claim', 'evidence', 'experiment'] as const;
type ChallengeTargetType = (typeof CHALLENGE_TARGET_TYPES)[number];

export const CHALLENGE_KINDS = [
  'contradiction',
  'missing_evidence',
  'alternative',
  'scope',
  'unknown',
  'methodology',
] as const;
type ChallengeKind = (typeof CHALLENGE_KINDS)[number];

export const CHALLENGE_STATUSES = ['open', 'resolved', 'wont_fix'] as const;
type ChallengeStatus = (typeof CHALLENGE_STATUSES)[number];

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

export const INVESTIGATION_ARTIFACT_STATUSES = ['draft', 'ready', 'stale', 'failed', 'superseded'] as const;
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
type EvidenceSourceKind = (typeof EVIDENCE_SOURCE_KINDS)[number];

export const EVIDENCE_OBSERVATION_KINDS = [
  'image_compare',
  'spirv_slice',
  'timing',
  'pixel_history',
  'mesh',
  'resource',
  'other',
] as const;
type EvidenceObservationKind = (typeof EVIDENCE_OBSERVATION_KINDS)[number];

export const EVIDENCE_STRENGTHS = ['strong', 'moderate', 'weak', 'none'] as const;
type EvidenceStrength = (typeof EVIDENCE_STRENGTHS)[number];

export const EVIDENCE_REGION_KINDS = ['pixel', 'event', 'resource'] as const;
type EvidenceRegionKind = (typeof EVIDENCE_REGION_KINDS)[number];

interface WorldStateReplay {
  adapter: string;
  driver: string;
  device: string;
  exclusiveLock: boolean;
}

interface WorldStateShaderReplacement {
  shaderId: string;
  replacementRef: string;
}

interface WorldStatePatch {
  patchId: string;
  summary: string;
}

interface WorldStateFocus {
  event?: string;
  resource?: string;
  pixel?: { x: number; y: number };
  subresource?: string;
}

interface WorldStateBenchmark {
  warmup: number;
  resolution: string;
  vsync: boolean;
  samplingProtocol: string;
}

interface WorldStateBenchmarkNotMeasured {
  status: 'not_measured';
  reason: string;
}

export interface WorldState {
  worldStateId: string;
  kind: WorldStateKind;
  captureRef: string;
  replay: WorldStateReplay;
  shaderReplacement: WorldStateShaderReplacement | null;
  patchStack: WorldStatePatch[];
  focus: WorldStateFocus;
  benchmark: WorldStateBenchmark | WorldStateBenchmarkNotMeasured;
  validity: WorldStateValidity;
}

interface EvidenceSource {
  kind: EvidenceSourceKind;
  name: string;
  parameterFingerprint: string;
}

export interface InvestigationContentRef {
  uri: string;
  expectedHash: string;
}

interface EvidenceRegion {
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

interface InvestigationClaimScope {
  capture?: string;
  eventId?: string;
  resourceId?: string;
  pass?: string;
  device?: string;
  api?: string;
  notes?: string;
}

interface ClaimRootCause {
  trigger: string;
  faultLocation: string;
  failureMechanism: string;
  propagation: string;
  manifestation: string;
  scope: string;
  counterfactualEvidence: string;
}

interface ClaimDecision {
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
  /** EvidenceRecord.evidenceId values the claim rests on; required (at least one) for a non-projected observed claim. */
  evidenceIds?: string[];
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

interface ExperimentIntervention {
  type: string;
  payload: Record<string, unknown>;
}

interface ExperimentProtocol {
  kind: ExperimentProtocolKind;
  warmup: number;
  noiseThreshold: number;
}

interface ExperimentMetric {
  name: string;
  kind: string;
  unit?: string;
}

interface ExperimentVisualValidation {
  before?: string;
  after?: string;
  diff?: string;
  region?: string;
}

interface ExperimentResult {
  summary: string;
  accepted: boolean;
}

interface ExperimentRollback {
  executed: boolean;
  baselineRestored: boolean;
  verifyEvidenceIds: string[];
}

export interface ExperimentRecord {
  /** Main-signed native execution receipts; absent on historical records. */
  executionEvidence?: Record<
    'baseline' | 'intervention' | 'variant' | 'rollback' | 'restored',
    InvestigationContentRef
  >;
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

interface ChallengeTargetRef {
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

export const REPORT_CANDIDATE_STATUSES = ['none', 'session-created', 'not-requested'] as const;
type ReportCandidateStatus = (typeof REPORT_CANDIDATE_STATUSES)[number];

export interface InvestigationReportContract {
  conclusion: string;
  evidence: string;
  verification: string;
  limitations: string;
  status: string;
  links: string;
  artifactIds: string[];
  candidateStatus: ReportCandidateStatus;
}

export interface InvestigationReport {
  title: string;
  mission: InvestigationMission;
  summary: string;
  claims: ClaimRecord[];
  evidenceIds: string[];
  experimentIds: string[];
  reportContract?: InvestigationReportContract;
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

export function bareInvestigationHash(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^sha256:/, '');
}

type InvestigationReadIpcStatus = 'ready' | 'degraded' | 'error' | 'hash-mismatch';

export interface InvestigationReadRequest {
  sessionId: string;
  artifactId: string;
  expectedHash: string;
}

export interface InvestigationReadIpcResult {
  ok: boolean;
  status: InvestigationReadIpcStatus;
  error?: string;
  errorCode?: string;
  manifest?: InvestigationArtifactManifest;
  record?: InvestigationRecord;
  contentHash?: string;
}
