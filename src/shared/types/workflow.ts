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

interface RunRecoveryState {
  restartedFromRunId?: string;
  recoveredAt?: string;
  recoveryReason?: string;
  staleDetectedAt?: string;
}

export interface WorkflowState {
  caseId: string;
  runId: string;
  sessionId: string;
  blockers: Blocker[];
  reasoningSummaries?: ReasoningSummary[];
  recoveryState?: RunRecoveryState | null;
  lastUpdated: string;
}

interface Blocker {
  code: string;
  reason: string;
  refs: string[];
  detectedAt: string;
  resolvedAt?: string;
}
