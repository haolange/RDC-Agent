import { z, type ZodType } from 'zod';
import {
  CHALLENGE_KINDS,
  CHALLENGE_STATUSES,
  CHALLENGE_TARGET_TYPES,
  CLAIM_DECISIONS,
  CLAIM_KINDS,
  CLAIM_PROJECTION_KINDS,
  CONFIDENCE_LEVELS,
  EPISTEMIC_STATUSES,
  EVIDENCE_OBSERVATION_KINDS,
  EVIDENCE_REGION_KINDS,
  EVIDENCE_SOURCE_KINDS,
  EVIDENCE_STRENGTHS,
  EXPERIMENT_ACTION_CLASSES,
  EXPERIMENT_PROTOCOLS,
  EXPERIMENT_STATUSES,
  INVESTIGATION_ARTIFACT_KINDS,
  INVESTIGATION_ARTIFACT_STATUSES,
  INVESTIGATION_MISSIONS,
  INVESTIGATION_RECORD_TYPES,
  INVESTIGATION_SCHEMA_NAMESPACE,
  VERIFICATION_LEVELS,
  WORLD_STATE_KINDS,
  WORLD_STATE_VALIDITIES,
  isCausalOrCounterfactualClaim,
  type ArtifactSourceRef,
  type ChallengeRecord,
  type ClaimRecord,
  type ClaimSet,
  type EvidencePack,
  type EvidenceRecord,
  type ExperimentRecord,
  type InvestigationArtifactManifest,
  type InvestigationReport,
  type MissionCheckpoint,
  type WorldState,
} from '@shared/types/renderdocInvestigation';

const nonEmpty = z.string().trim().min(1);
const hashValue = z.string().trim().min(16);
const optionalNonEmpty = nonEmpty.optional();

export const WorldStateSchema: ZodType<WorldState> = z.object({
  worldStateId: nonEmpty,
  kind: z.enum(WORLD_STATE_KINDS),
  captureRef: nonEmpty.refine((value) => !/^[a-zA-Z]:[\\/]/.test(value) && !value.startsWith('/') && !value.startsWith('\\'), {
    message: 'captureRef must be session-owned, not an absolute path',
  }),
  replay: z.object({
    adapter: nonEmpty,
    driver: nonEmpty,
    device: nonEmpty,
    exclusiveLock: z.boolean(),
  }).strict(),
  shaderReplacement: z.object({
    shaderId: nonEmpty,
    replacementRef: nonEmpty,
  }).strict().nullable(),
  patchStack: z.array(z.object({
    patchId: nonEmpty,
    summary: nonEmpty,
  }).strict()),
  focus: z.object({
    event: optionalNonEmpty,
    resource: optionalNonEmpty,
    pixel: z.object({ x: z.number(), y: z.number() }).strict().optional(),
    subresource: optionalNonEmpty,
  }).strict(),
  benchmark: z.object({
    warmup: z.number().nonnegative(),
    resolution: nonEmpty,
    vsync: z.boolean(),
    samplingProtocol: nonEmpty,
  }).strict(),
  validity: z.enum(WORLD_STATE_VALIDITIES),
}).strict();

const EvidenceRecordShape = z.object({
  evidenceId: nonEmpty,
  mission: z.enum(INVESTIGATION_MISSIONS),
  observationKind: z.enum(EVIDENCE_OBSERVATION_KINDS),
  summary: nonEmpty,
  epistemicStatus: z.enum(EPISTEMIC_STATUSES),
  worldStateId: nonEmpty,
  source: z.object({
    kind: z.enum(EVIDENCE_SOURCE_KINDS),
    name: nonEmpty,
    parameterFingerprint: nonEmpty,
  }).strict(),
  artifactRefs: z.array(z.object({
    uri: nonEmpty,
    expectedHash: hashValue,
  }).strict()),
  contentHashes: z.array(hashValue),
  taskRef: optionalNonEmpty,
  claimIds: z.array(nonEmpty),
  experimentId: nonEmpty.nullable().optional(),
  region: z.object({
    kind: z.enum(EVIDENCE_REGION_KINDS),
    spec: nonEmpty,
  }).strict().optional(),
  strength: z.enum(EVIDENCE_STRENGTHS),
  stale: z.boolean(),
}).strict();

export const EvidenceRecordSchema: ZodType<EvidenceRecord> = EvidenceRecordShape;

export const EvidencePackSchema: ZodType<EvidencePack> = z.object({
  items: z.array(EvidenceRecordShape),
}).strict();

const ClaimScopeSchema = z.object({
  capture: optionalNonEmpty,
  eventId: optionalNonEmpty,
  resourceId: optionalNonEmpty,
  pass: optionalNonEmpty,
  device: optionalNonEmpty,
  api: optionalNonEmpty,
  notes: optionalNonEmpty,
}).strict().refine((scope) => Object.values(scope).some((value) => typeof value === 'string' && value.length > 0), {
  message: 'Claim scope must include at least one axis',
});

const CompactProvenanceSchema = z.object({
  sourceClaimId: nonEmpty,
  sourceEpistemicStatus: z.enum(EPISTEMIC_STATUSES),
  sourceVerificationLevel: z.enum(VERIFICATION_LEVELS),
}).strict();

const ClaimRecordShape = z.object({
  claimId: nonEmpty,
  claimKind: z.enum(CLAIM_KINDS),
  statement: nonEmpty,
  epistemic: z.enum(EPISTEMIC_STATUSES),
  confidence: z.enum(CONFIDENCE_LEVELS),
  verification: z.enum(VERIFICATION_LEVELS),
  worldStateId: nonEmpty,
  experimentId: nonEmpty.nullable(),
  declaresCounterfactual: z.boolean(),
  supports: z.array(nonEmpty).optional(),
  contradicts: z.array(nonEmpty).optional(),
  scope: ClaimScopeSchema,
  rootCause: z.object({
    trigger: nonEmpty,
    faultLocation: nonEmpty,
    failureMechanism: nonEmpty,
    propagation: nonEmpty,
    manifestation: nonEmpty,
    scope: nonEmpty,
    counterfactualEvidence: nonEmpty,
  }).strict().optional(),
  decision: z.object({
    verdict: z.enum(CLAIM_DECISIONS),
    reason: nonEmpty,
    challengeId: optionalNonEmpty,
  }).strict().optional(),
  projectionKind: z.enum(CLAIM_PROJECTION_KINDS).nullable(),
  compactProvenance: z.array(CompactProvenanceSchema).nullable(),
}).strict().superRefine((claim, ctx) => {
  if (isCausalOrCounterfactualClaim(claim) && !claim.experimentId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['experimentId'],
      message: 'causal_conclusion or counterfactual Claim requires experimentId',
    });
  }
  if (claim.projectionKind && (!claim.compactProvenance || claim.compactProvenance.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['compactProvenance'],
      message: 'projected Claim requires non-empty compactProvenance',
    });
  }
});

export const ClaimRecordSchema: ZodType<ClaimRecord> = ClaimRecordShape;

export const ClaimSetSchema: ZodType<ClaimSet> = z.object({
  items: z.array(ClaimRecordShape),
}).strict();

export const ExperimentRecordSchema: ZodType<ExperimentRecord> = z.object({
  experimentId: nonEmpty,
  hypothesisClaimId: nonEmpty,
  intervention: z.object({
    type: nonEmpty,
    payload: z.record(z.string(), z.unknown()),
  }).strict(),
  baselineWorldStateId: nonEmpty,
  variantWorldStateId: nonEmpty,
  restoredWorldStateId: nonEmpty,
  controlledVariables: z.array(nonEmpty),
  changedVariables: z.array(nonEmpty),
  metrics: z.array(z.object({
    name: nonEmpty,
    kind: nonEmpty,
    unit: optionalNonEmpty,
  }).strict()),
  protocol: z.object({
    kind: z.enum(EXPERIMENT_PROTOCOLS),
    warmup: z.number().nonnegative(),
    noiseThreshold: z.number().nonnegative(),
  }).strict(),
  visualValidation: z.object({
    before: optionalNonEmpty,
    after: optionalNonEmpty,
    diff: optionalNonEmpty,
    region: optionalNonEmpty,
  }).strict().optional(),
  result: z.object({
    summary: nonEmpty,
    accepted: z.boolean(),
  }).strict().optional(),
  rollback: z.object({
    executed: z.boolean(),
    baselineRestored: z.boolean(),
    verifyEvidenceIds: z.array(nonEmpty),
  }).strict(),
  actionClass: z.enum(EXPERIMENT_ACTION_CLASSES).optional(),
  status: z.enum(EXPERIMENT_STATUSES),
}).strict().superRefine((experiment, ctx) => {
  if ((experiment.status === 'recorded' || experiment.status === 'rolled_back') && !experiment.result) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['result'],
      message: 'result is required when status is recorded or rolled_back',
    });
  }
});

export const ChallengeRecordSchema: ZodType<ChallengeRecord> = z.object({
  challengeId: nonEmpty,
  targetRef: z.object({
    type: z.enum(CHALLENGE_TARGET_TYPES),
    id: nonEmpty,
  }).strict(),
  challengeKind: z.enum(CHALLENGE_KINDS),
  statement: nonEmpty,
  requiredFollowUp: optionalNonEmpty,
  status: z.enum(CHALLENGE_STATUSES),
  resolutionClaimId: optionalNonEmpty,
}).strict().superRefine((challenge, ctx) => {
  if (challenge.status === 'resolved' && !challenge.resolutionClaimId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['resolutionClaimId'],
      message: 'resolved Challenge requires resolutionClaimId',
    });
  }
});

export const MissionCheckpointSchema: ZodType<MissionCheckpoint> = z.object({
  checkpointId: nonEmpty,
  goal: nonEmpty,
  planVersion: nonEmpty,
  established: z.array(nonEmpty),
  rejected: z.array(nonEmpty),
  completedExperiments: z.array(nonEmpty),
  openChallenges: z.array(nonEmpty),
  reasonForReplan: optionalNonEmpty,
  currentWorldStateId: nonEmpty,
  criticalArtifactRefs: z.array(nonEmpty),
  unresolvedFrontier: nonEmpty,
}).strict();

export const InvestigationReportSchema: ZodType<InvestigationReport> = z.object({
  title: nonEmpty,
  mission: z.enum(INVESTIGATION_MISSIONS),
  summary: nonEmpty,
  claims: z.array(ClaimRecordShape),
  evidenceIds: z.array(nonEmpty),
  experimentIds: z.array(nonEmpty),
}).strict();

export const ArtifactSourceRefSchema: ZodType<ArtifactSourceRef> = z.object({
  artifactId: nonEmpty,
  expectedHash: hashValue,
}).strict();

export const InvestigationIndexEntrySchema = z.object({
  artifactId: nonEmpty,
  kind: z.enum(INVESTIGATION_ARTIFACT_KINDS),
  recordType: nonEmpty,
  status: z.enum(INVESTIGATION_ARTIFACT_STATUSES),
  contentUri: nonEmpty,
  manifestUri: nonEmpty,
  contentHash: hashValue,
  createdAt: nonEmpty,
  supersedes: optionalNonEmpty,
  recordKey: z.string(),
}).strict();

export const InvestigationIndexDocumentSchema = z.object({
  schemaVersion: z.literal(INVESTIGATION_SCHEMA_NAMESPACE),
  artifacts: z.array(InvestigationIndexEntrySchema),
}).strict();

export const InvestigationArtifactManifestSchema: ZodType<InvestigationArtifactManifest> = z.object({
  artifactId: nonEmpty,
  mission: z.enum(INVESTIGATION_MISSIONS),
  kind: z.enum(INVESTIGATION_ARTIFACT_KINDS),
  status: z.enum(INVESTIGATION_ARTIFACT_STATUSES),
  title: nonEmpty,
  summary: nonEmpty,
  contentRef: nonEmpty,
  sourceRefs: z.array(ArtifactSourceRefSchema),
  contentHash: hashValue,
  recordType: z.enum(INVESTIGATION_RECORD_TYPES),
  worldStateId: optionalNonEmpty,
  supersedes: optionalNonEmpty,
  createdAt: nonEmpty,
}).strict();

const RECORD_SCHEMAS: Record<string, ZodType<unknown>> = {
  WorldState: WorldStateSchema,
  EvidenceRecord: EvidenceRecordSchema,
  EvidencePack: EvidencePackSchema,
  ClaimRecord: ClaimRecordSchema,
  ClaimSet: ClaimSetSchema,
  ExperimentRecord: ExperimentRecordSchema,
  ChallengeRecord: ChallengeRecordSchema,
  MissionCheckpoint: MissionCheckpointSchema,
  InvestigationReport: InvestigationReportSchema,
};

export function parseInvestigationRecord(recordType: string, value: unknown): unknown {
  const schema = RECORD_SCHEMAS[recordType];
  if (!schema) {
    throw new Error(`unknown recordType ${recordType}`);
  }
  return schema.parse(value);
}

const OPAQUE_KEYS = new Set([
  'opaqueProviderPayload',
  'rawProviderOutput',
  'providerOpaque',
  'opaquePayload',
]);

export function assertNoOpaqueProviderPayload(value: unknown, path = 'record'): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoOpaqueProviderPayload(item, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (OPAQUE_KEYS.has(key)) {
      throw new Error(`${path}.${key}`);
    }
    assertNoOpaqueProviderPayload(child, `${path}.${key}`);
  }
}
