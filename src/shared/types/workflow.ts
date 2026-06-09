import type { AgentRole } from './agent';
import type { HarnessTask } from './harness';

export type WorkflowStage =
  | 'preflight'
  | 'entry_gate'
  | 'intake_gate'
  | 'speclist'
  | 'dispatch'
  | 'investigate'
  | 'fix_verify'
  | 'skepti'
  | 'curate'
  | 'finalize'
  | 'blocked';

export type WorkflowPhase =
  | 'planner'
  | 'generator'
  | 'evaluator';

export interface ReasoningSummary {
  summaryId: string;
  stage: WorkflowStage;
  agentId: AgentRole;
  summary: string;
  evidence: string[];
  nextStep: string;
  confidence: number;
  createdAt: string;
}

export interface RunRecoveryState {
  restartedFromRunId?: string;
  recoveredAt?: string;
  recoveryReason?: string;
  staleDetectedAt?: string;
}

export interface IntakeContext {
  taskFilePath?: string;
  taskFileContent?: string;
  effectiveGoal: string;
  discoveredProjectRoot?: string;
  openedCaptureId?: string | null;
  openedCapturePath?: string | null;
  availableCaptureIds: string[];
  providerId?: string;
  modelId?: string;
  replayDeviceId?: string | null;
  replayDeviceLabel?: string | null;
}

export interface WorkflowState {
  caseId: string;
  runId: string;
  sessionId: string;
  currentStage: WorkflowStage;
  previousStages: WorkflowStage[];
  entryMode: 'cli' | 'mcp';
  backend: 'local' | 'remote';
  orchestrationMode: 'multi_agent';
  coordinationMode: 'staged_handoff';
  blockers: Blocker[];
  harnessTasks?: HarnessTask[];
  reasoningSummaries?: ReasoningSummary[];
  recoveryState?: RunRecoveryState | null;
  lastUpdated: string;
}

export interface Blocker {
  code: string;
  reason: string;
  refs: string[];
  detectedAt: string;
  resolvedAt?: string;
}

export type WorkflowStateView =
  | (WorkflowState & { currentStage: 'blocked'; blockers: [Blocker, ...Blocker[]] })
  | WorkflowState;

export interface GateResult {
  stage: string;
  status: 'passed' | 'blocked' | 'pending';
  blockers: Blocker[];
  refs: string[];
  paths: Record<string, string>;
  extra?: Record<string, unknown>;
}

export interface Report {
  title: string;
  summary: string;
  rootCause: string;
  fixDescription: string;
  evidenceSummary: string[];
  recommendations: string[];
  confidence: number;
  generatedAt: string;
  curatorAgentId: string;
}

export interface ModeCapabilities {
  mode: import('./session').AppMode;
  availableStages: WorkflowStage[];
  requiresLLM: boolean;
  isFullyImplemented: boolean;
  disabledReason?: string;
}
