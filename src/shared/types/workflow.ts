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

export interface WorkflowState {
  caseId: string;
  runId: string;
  sessionId: string;
  entryMode: 'cli' | 'mcp';
  backend: 'local' | 'remote';
  orchestrationMode: 'multi_agent';
  coordinationMode: 'turn_handoff';
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
