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
  REPORT_CANDIDATE_STATUSES,
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
  benchmark: z.union([
    z.object({
      warmup: z.number().nonnegative(),
      resolution: nonEmpty,
      vsync: z.boolean(),
      samplingProtocol: nonEmpty,
    }).strict(),
    z.object({ status: z.literal('not_measured'), reason: nonEmpty }).strict(),
  ]),
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

const EvidenceWriteShape = EvidenceRecordShape.omit({ contentHashes: true });
const EvidencePackWriteShape = z.object({ items: z.array(EvidenceWriteShape) }).strict();

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

const projectionKindHelp = 'Required: use null for an original Claim; compact, report, and view denote projections of existing Claims.';
const compactProvenanceHelp = 'Required: use null for an original Claim; a projection, including a report Claim, needs a non-empty array of source Claim fields.';

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
  projectionKind: z.enum(CLAIM_PROJECTION_KINDS, { error: projectionKindHelp }).nullable().describe(projectionKindHelp),
  compactProvenance: z.array(CompactProvenanceSchema, { error: compactProvenanceHelp }).nullable().describe(compactProvenanceHelp),
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
      message: 'projected Claim requires non-empty compactProvenance; an original Claim uses null for both projectionKind and compactProvenance',
    });
  }
});

export const ClaimRecordSchema: ZodType<ClaimRecord> = ClaimRecordShape;

export const ClaimSetSchema: ZodType<ClaimSet> = z.object({
  items: z.array(ClaimRecordShape),
}).strict();

export const ExperimentRecordSchema: ZodType<ExperimentRecord> = z.object({
  executionEvidence: z.object({
    baseline: z.object({ uri: nonEmpty, expectedHash: nonEmpty }).strict(),
    intervention: z.object({ uri: nonEmpty, expectedHash: nonEmpty }).strict(),
    variant: z.object({ uri: nonEmpty, expectedHash: nonEmpty }).strict(),
    rollback: z.object({ uri: nonEmpty, expectedHash: nonEmpty }).strict(),
    restored: z.object({ uri: nonEmpty, expectedHash: nonEmpty }).strict(),
  }).strict().optional(),
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
  planVersion: nonEmpty.describe('Stable approved plan version or artifact ID (for example plan-...); do not manually transcribe a content SHA-256 digest here. Verify the frozen plan URI and hash through its plan artifact.'),
  established: z.array(nonEmpty).describe('Resolvable investigation ClaimRecord.claimId values; not artifact URIs.'),
  rejected: z.array(nonEmpty).describe('Resolvable investigation ClaimRecord.claimId values; not artifact URIs.'),
  completedExperiments: z.array(nonEmpty).describe('Resolvable investigation ExperimentRecord.experimentId values.'),
  openChallenges: z.array(nonEmpty).describe('Resolvable investigation ChallengeRecord.challengeId values.'),
  reasonForReplan: optionalNonEmpty,
  currentWorldStateId: nonEmpty.describe('Resolvable investigation WorldState.worldStateId.'),
  criticalArtifactRefs: z.array(nonEmpty).describe('Resolvable investigation manifest artifactId values (for example invart-...); not session:// URI strings. Raw content URI and hash pairs belong in EvidenceRecord.artifactRefs.'),
  unresolvedFrontier: nonEmpty,
}).strict();

export const InvestigationReportSchema: ZodType<InvestigationReport> = z.object({
  title: nonEmpty,
  mission: z.enum(INVESTIGATION_MISSIONS),
  summary: nonEmpty,
  claims: z.array(ClaimRecordShape).describe('A ready report needs projected conclusion Claims with source provenance. Current ClaimSet items are valid sources; an empty array cannot qualify a ready report.'),
  evidenceIds: z.array(nonEmpty).describe('Logical EvidenceRecord.evidenceId values, including EvidencePack item IDs; not Investigation artifactId values.'),
  experimentIds: z.array(nonEmpty),
  reportContract: z.object({
    conclusion: nonEmpty,
    evidence: nonEmpty,
    verification: nonEmpty,
    limitations: nonEmpty,
    status: nonEmpty.describe('For Mission completed, use exactly verified, conclusive or complete (case-insensitive). Other text cannot satisfy the completion gate.'),
    links: nonEmpty,
    artifactIds: z.array(nonEmpty).min(1),
    candidateStatus: z.enum(REPORT_CANDIDATE_STATUSES),
  }).strict().optional(),
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

/** The write shape exposed to callers; persisted records retain their canonical read shape. */
export function getInvestigationRecordJsonSchema(recordType: string): Record<string, unknown> {
  const schema = recordType === 'EvidenceRecord' ? EvidenceWriteShape
    : recordType === 'EvidencePack' ? EvidencePackWriteShape : RECORD_SCHEMAS[recordType];
  if (!schema) throw new Error(`unknown recordType ${recordType}`);
  return z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' }) as Record<string, unknown>;
}

/** Derive the stored duplicate from the caller's single set of hash-bound references. */
export function parseInvestigationWriteRecord(recordType: string, value: unknown): unknown {
  if (recordType === 'EvidenceRecord') {
    const input = EvidenceWriteShape.parse(value);
    return EvidenceRecordSchema.parse({ ...input, contentHashes: input.artifactRefs.map(ref => ref.expectedHash) });
  }
  if (recordType === 'EvidencePack') {
    const input = EvidencePackWriteShape.parse(value);
    return EvidencePackSchema.parse({ items: input.items.map(item => ({
      ...item, contentHashes: item.artifactRefs.map(ref => ref.expectedHash),
    })) });
  }
  return parseInvestigationRecord(recordType, value);
}

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
