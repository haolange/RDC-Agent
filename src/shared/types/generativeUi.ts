export type GenerativeUiStopReason = 'success' | 'blocked' | 'exhausted' | 'no_op';
export type GenerativeUiVerificationLevel = 1 | 2 | 3;

export interface GenerativeUiSpec {
  title: string;
  intent: string;
  layout: string;
  components: Array<{ id: string; kind: string; purpose: string }>;
  interactions: Array<{ trigger: string; effect: string }>;
  dataBindings: Array<{ source: string; target: string }>;
  visualStyle: string;
  responsiveRequirements: string[];
}

export interface GenerativeUiSource {
  html: string;
  css: string;
  javascript: string;
}

export interface GenerativeUiVerificationResult {
  level: GenerativeUiVerificationLevel;
  passed: boolean;
  checks: Array<{ id: string; passed: boolean; message: string }>;
  observedAt: number;
}

export interface GenerativeUiIterationMetrics {
  planningMs: number;
  generationMs: number;
  renderMs: number;
  verificationMs: number;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
}

export interface GenerativeUiContextReference {
  kind: 'data' | 'asset';
  name: string;
  source: string;
  scope: 'session';
  hash: string;
  precedence: 'supplemental';
  redaction: 'caller_redacted';
}

export interface GenerativeUiVersion {
  versionId: string;
  parentVersionId: string | null;
  branchId: string;
  prompt: string;
  contextReferences: GenerativeUiContextReference[];
  spec: GenerativeUiSpec;
  source: GenerativeUiSource;
  reflection: string | null;
  runtimePolicy: 'automatic' | 'human';
  runtimeDecision: 'pending' | 'processing' | 'continue' | 'success' | 'blocked' | null;
  runtimeReflection: string | null;
  verification: GenerativeUiVerificationResult[];
  usableAt?: number;
  metrics: GenerativeUiIterationMetrics;
  createdAt: number;
}

export interface GenerativeUiBranch {
  branchId: string;
  name: string;
  headVersionId: string | null;
  createdFromVersionId: string | null;
  createdAt: number;
}

export interface GenerativeUiCanvas {
  schemaVersion: 1;
  canvasId: string;
  projectId: string;
  sessionId: string;
  title: string;
  originalPrompt: string;
  benchmarkCaseId?: string;
  activeBranchId: string;
  branches: GenerativeUiBranch[];
  versions: GenerativeUiVersion[];
  observations: GenerativeUiObservation[];
  feedback: GenerativeUiFeedback[];
  stopReason: GenerativeUiStopReason | null;
  createdAt: number;
  updatedAt: number;
}

export type GenerativeUiRuntimeEventType = 'ready' | 'runtime_error' | 'unhandled_rejection' | 'interaction';
export interface GenerativeUiRuntimeEventDetails { message?: string; interactionType?: string; latencyMs?: number }

export interface GenerativeUiObservation {
  observationId: string;
  versionId: string;
  eventType: GenerativeUiRuntimeEventType;
  message?: string;
  interactionType?: string;
  latencyMs?: number;
  observedAt: number;
}

export interface GenerativeUiFeedback {
  feedbackId: string;
  versionId: string;
  rating: 1 | 2 | 3 | 4 | 5;
  usable: boolean;
  preferredOverStatic?: boolean;
  comment?: string;
  createdAt: number;
}

export interface GenerativeUiEvaluationSummary {
  canvasCount: number;
  generatedCanvasCount: number;
  successfulCanvasCount: number;
  generationSuccessRate: number;
  versionCount: number;
  closedLoopVersionCount: number;
  loopClosureRate: number;
  feedbackCount: number;
  dynamicUiPreferredCount: number;
  dynamicUiPreferenceRate: number | null;
  medianIterationMs: number | null;
  medianPromptToUsableMs: number | null;
  promptToUsableSampleCount: number;
  medianPreviewReadyMs: number | null;
  previewReadySampleCount: number;
  canvasesWithFiveEffectiveIterations: number;
  runtimeErrorCount: number;
  targetStatus: {
    generationSuccessRate: boolean;
    loopClosureRate: boolean;
    previewReadyLatency: boolean | null;
    dynamicUiPreferenceRate: boolean | null;
  };
}

export type GenerativeUiOuterEvidenceKind = 'use_case' | 'competitor_observation' | 'expert_review' | 'blind_preference';
export interface GenerativeUiOuterEvidence {
  evidenceId: string;
  kind: GenerativeUiOuterEvidenceKind;
  title: string;
  source: string;
  notes: string;
  canvasId?: string;
  versionId?: string;
  score?: number;
  outcome?: 'passed' | 'failed' | 'dynamic' | 'static' | 'tie';
  blinded?: boolean;
  candidateOrder?: 'dynamic_first' | 'static_first';
  staticReference?: string;
  createdAt: number;
}

export interface AddGenerativeUiOuterEvidenceRequest {
  kind: GenerativeUiOuterEvidenceKind;
  title: string;
  source: string;
  notes: string;
  canvasId?: string;
  versionId?: string;
  score?: number;
  outcome?: GenerativeUiOuterEvidence['outcome'];
  blinded?: boolean;
  candidateOrder?: GenerativeUiOuterEvidence['candidateOrder'];
  staticReference?: string;
}

export interface GenerativeUiOuterLoopReport {
  generatedAt: number;
  cadence: 'weekly';
  metrics: GenerativeUiEvaluationSummary;
  evidenceCounts: Record<GenerativeUiOuterEvidenceKind, number>;
  benchmark: { version: string; caseCount: number; attemptedCaseCount: number; successfulCaseCount: number; categorySuccess: Record<GenerativeUiBenchmarkCategory, number> };
  gaps: string[];
  actions: string[];
  decision: 'continue' | 'v1_ready' | 'plan_next_version';
}

export interface CommitGenerativeUiVersionRequest {
  canvasId: string;
  branchId: string;
  parentVersionId: string | null;
  prompt: string;
  contextReferences?: GenerativeUiContextReference[];
  spec: GenerativeUiSpec;
  source: GenerativeUiSource;
  reflection?: string | null;
  runtimePolicy: GenerativeUiVersion['runtimePolicy'];
  verification?: GenerativeUiVerificationResult[];
  metrics: GenerativeUiIterationMetrics;
}

export interface GenerativeUiLoopBudget {
  maxIterations: number;
  maxTotalMs: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxEstimatedCostUsd?: number;
  maxStagnantIterations?: number;
}

export interface GenerativeUiLoopRequest {
  projectId: string;
  sessionId: string;
  prompt: string;
  modelPrompt?: string;
  modelImages?: Array<{ mediaType: string; data: string }>;
  contextReferences?: GenerativeUiContextReference[];
  title?: string;
  benchmarkCaseId?: string;
  canvasId?: string;
  branchId?: string;
  checkpoint: 'automatic' | 'after_generation' | 'after_verification';
  budget: GenerativeUiLoopBudget;
}

export type GenerativeUiBenchmarkCategory = 'website' | 'dashboard' | 'simulator' | 'tool' | 'visualization' | 'game';
export interface GenerativeUiBenchmarkCase {
  caseId: string;
  category: GenerativeUiBenchmarkCategory;
  title: string;
  prompt: string;
  requiredInteractions: string[];
  requiredEvidence: string[];
}

export interface GenerativeUiLoopResult {
  canvas: GenerativeUiCanvas;
  version: GenerativeUiVersion | null;
  iterations: number;
  stopReason: GenerativeUiStopReason;
  awaitingCheckpoint: boolean;
  diagnostics: string[];
  fallback: { kind: 'static' | 'human'; message: string } | null;
}
