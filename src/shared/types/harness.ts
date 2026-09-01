import type { AgentRole } from './agent';

export type HarnessSchemaVersion = '1';

export type HarnessStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type EvidenceKind =
  | 'capture'
  | 'tool'
  | 'analysis'
  | 'verification'
  | 'artifact'
  | 'user'
  | 'system';

export type EvidenceStrength = 'weak' | 'supporting' | 'strong' | 'decisive';

export type ArtifactKind =
  | 'capture'
  | 'screenshot'
  | 'shader'
  | 'trace'
  | 'report'
  | 'log'
  | 'data'
  | 'note';

export type VerificationStatus =
  | 'not_run'
  | 'passed'
  | 'failed'
  | 'blocked'
  | 'inconclusive';

export type VerificationRoute =
  | 'generator'
  | 'plan_revision'
  | 'ask_user'
  | 'curator'
  | 'blocked';

export type VerificationMethod =
  | 'tool'
  | 'screenshot'
  | 'pixel'
  | 'shader'
  | 'baseline'
  | 'manual'
  | 'llm_review';

export type ContextPacketKind =
  | 'intake'
  | 'plan'
  | 'capture'
  | 'tool_result'
  | 'agent_note'
  | 'verification'
  | 'handoff';

export type ToolLayer =
  | 'rdx_cli'
  | 'system'
  | 'skill'
  | 'mcp';

export interface AskUserQuestionOption {
  optionId: string;
  label: string;
  description?: string;
}

export interface AskUserQuestionRequest {
  questionId: string;
  runId: string;
  sessionId: string;
  prompt: string;
  reason: string;
  options?: AskUserQuestionOption[];
  allowFreeform: boolean;
  requestedBy: AgentRole | 'harness';
  createdAt: string;
}

export interface AskUserQuestionAnswer {
  questionId: string;
  runId: string;
  sessionId: string;
  selectedOptionId?: string;
  freeformText?: string;
  answeredAt: string;
}

export interface CapabilityProfile {
  profileId: string;
  owner: AgentRole | 'harness';
  toolLayers: ToolLayer[];
  toolNames: string[];
  writeScopes: string[];
  liveReplayRequired: boolean;
  remoteReplaySupported: boolean;
  limits: Record<string, string | number | boolean>;
  createdAt: string;
  updatedAt: string;
}

export interface VerificationContract {
  contractId: string;
  runId: string;
  sessionId: string;
  requiredMethods: VerificationMethod[];
  targetRefs: string[];
  successCriteria: string[];
  evidenceRequirements: string[];
  blockerCodes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface EvidenceRecord {
  evidenceId: string;
  runId: string;
  sessionId: string;
  kind: EvidenceKind;
  title: string;
  summary: string;
  refs: string[];
  taskId?: string;
  agentId?: AgentRole | 'harness';
  artifactIds: string[];
  strength: EvidenceStrength;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ArtifactRecord {
  artifactId: string;
  runId: string;
  sessionId: string;
  kind: ArtifactKind;
  title: string;
  filePath: string;
  mimeType: string;
  sizeBytes: number;
  sha256?: string;
  taskId?: string;
  evidenceIds: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AgentResultCard {
  cardId: string;
  runId: string;
  sessionId: string;
  agentId: AgentRole;
  taskId?: string;
  status: HarnessStatus;
  summary: string;
  evidenceIds: string[];
  artifactIds: string[];
  verificationResultIds: string[];
  nextActions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ContextPacket {
  packetId: string;
  runId: string;
  sessionId: string;
  kind: ContextPacketKind;
  source: AgentRole | 'harness' | 'user' | 'system';
  title: string;
  summary: string;
  content: string;
  refs: string[];
  taskIds: string[];
  evidenceIds: string[];
  artifactIds: string[];
  tokenEstimate?: number;
  createdAt: string;
}
