import type { AgentRole } from './agent';

export interface ReasoningSummary {
  summaryId: string;
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
  entryMode: 'cli' | 'mcp';
  backend: 'local' | 'remote';
  orchestrationMode: 'multi_agent';
  coordinationMode: 'staged_handoff';
  blockers: Blocker[];
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

export type WorkflowStateView = WorkflowState;

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
  profileId: string;
  requiresLLM: boolean;
  isFullyImplemented: boolean;
  disabledReason?: string;
}
