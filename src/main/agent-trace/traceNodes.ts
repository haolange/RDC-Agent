import type { TraceStatus } from '@shared/types/agenticTrace/base';

export type TraceVisibility = 'user' | 'debug' | 'internal';

export interface BaseTraceNode {
  id: string;
  runId: string;
  parentId?: string;
  seq: number;
  createdAt: string;
  updatedAt?: string;
  kind: string;
  status?: TraceStatus;
  visibility: TraceVisibility;
  metadata?: Record<string, unknown>;
}

export type EvidenceRefKind = 'trace_node' | 'tool_call' | 'artifact' | 'file_range' | 'url' | 'log' | 'domain_object';

export interface EvidenceRef {
  kind: EvidenceRefKind;
  refId: string;
  label?: string;
  metadata?: Record<string, unknown>;
}

export type AttachmentKind = 'file' | 'image' | 'audio' | 'video' | 'url' | 'text' | 'binary';

export interface AttachmentRef {
  attachmentId: string;
  kind: AttachmentKind;
  name?: string;
  uri?: string;
  mimeType?: string;
  metadata?: Record<string, unknown>;
}

export type ArtifactRefKind =
  'file' | 'code' | 'diff' | 'image' | 'table' | 'chart' | 'json' | 'log' | 'link' | 'binary' | 'domain_object';

export interface ArtifactRef {
  artifactId: string;
  kind: ArtifactRefKind;
  title: string;
  uri?: string;
  preview?: ToolResultPreview;
  metadata?: Record<string, unknown>;
}

export interface TextPreview {
  kind: 'text';
  text: string;
}

export interface CodePreview {
  kind: 'code';
  language?: string;
  code: string;
  path?: string;
  startLine?: number;
  endLine?: number;
}

export interface LogPreview {
  kind: 'log';
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

export interface DiffPreview {
  kind: 'diff';
  path: string;
  unifiedDiff: string;
}

export interface ImagePreview {
  kind: 'image';
  url: string;
  width?: number;
  height?: number;
}

export interface TablePreview {
  kind: 'table';
  columns: string[];
  rows: unknown[][];
}

export interface JsonPreview {
  kind: 'json';
  value: unknown;
}

export interface ArtifactPreview {
  kind: 'artifact';
  artifactId: string;
}

export type ToolResultPreview =
  TextPreview | CodePreview | LogPreview | DiffPreview | ImagePreview | TablePreview | JsonPreview | ArtifactPreview;

export type ReasoningConfidence = 'low' | 'medium' | 'high';

export type VisibleReasoningMode =
  | 'task_understanding'
  | 'planning'
  | 'intent'
  | 'hypothesis'
  | 'evidence_need'
  | 'observation_summary'
  | 'decision_update'
  | 'next_action'
  | 'risk_note'
  | 'summary';

export type PhaseKind =
  'understand' | 'plan' | 'search' | 'inspect' | 'modify' | 'execute' | 'verify' | 'summarize' | 'custom';

export interface TaskFrameNode extends BaseTraceNode {
  kind: 'task_frame';
  title: string;
  userRequest: string;
  contextSummary?: string;
  constraints?: string[];
  expectedOutput?: string;
}

export interface UserMessageNode extends BaseTraceNode {
  kind: 'user_message';
  content: string;
  attachments?: AttachmentRef[];
}

export interface AssistantMessageNode extends BaseTraceNode {
  kind: 'assistant_message';
  content: string;
  format: 'markdown' | 'plain';
}

export interface ThoughtSummaryNode extends BaseTraceNode {
  kind: 'thought_summary';
  title?: string;
  mode?: VisibleReasoningMode;
  intent: string;
  rationale?: string;
  hypothesis?: string;
  evidenceNeed?: string;
  nextAction?: string;
  confidence?: ReasoningConfidence;
}

export interface PlanStep {
  id: string;
  title: string;
  description?: string;
  status: TraceStatus;
}

export interface PlanNode extends BaseTraceNode {
  kind: 'plan';
  title?: string;
  steps: PlanStep[];
}

export interface PhaseGroupNode extends BaseTraceNode {
  kind: 'phase_group';
  title: string;
  description?: string;
  phase: PhaseKind;
  children: TraceNode[];
  status: TraceStatus;
}

export interface ToolActionNode extends BaseTraceNode {
  kind: 'tool_action';
  toolCallId: string;
  toolName: string;
  displayName: string;
  category: ToolCategory;
  purpose?: string;
  inputPreview?: string;
  outputPreview?: string;
  rawInput?: unknown;
  rawOutput?: unknown;
  durationMs?: number;
  status: TraceStatus;
  artifacts?: ArtifactRef[];
  evidenceRefs?: EvidenceRef[];
  preview?: ToolResultPreview;
}

export type ArtifactNodeKind =
  'file' | 'code' | 'diff' | 'image' | 'table' | 'chart' | 'json' | 'log' | 'link' | 'binary' | 'domain_object';

export interface ArtifactNode extends BaseTraceNode {
  kind: 'artifact';
  artifactId: string;
  artifactKind: ArtifactNodeKind;
  title: string;
  uri?: string;
  preview?: ToolResultPreview;
  metadata?: Record<string, unknown>;
}

export interface ApprovalAction {
  id: string;
  label: string;
  style: 'primary' | 'secondary' | 'danger';
}

export interface ApprovalNode extends Omit<BaseTraceNode, 'status'> {
  kind: 'approval';
  approvalId: string;
  title: string;
  description?: string;
  riskLevel: 'low' | 'medium' | 'high';
  proposedActions: ApprovalAction[];
  status: 'waiting_approval' | 'approved' | 'rejected';
}

export interface ErrorNode extends BaseTraceNode {
  kind: 'error';
  title: string;
  message: string;
  code?: string;
  recoverable?: boolean;
  retryAction?: {
    label: string;
    action: string;
  };
  debug?: unknown;
}

export interface SubAgentNode extends BaseTraceNode {
  kind: 'sub_agent';
  subRunId: string;
  agentName: string;
  title: string;
  inputSummary?: string;
  outputSummary?: string;
  children?: TraceNode[];
  status: TraceStatus;
}

export interface FinalResponseNode extends BaseTraceNode {
  kind: 'final_response';
  content: string;
  format: 'markdown' | 'plain';
  referencedFindings?: string[];
  referencedArtifacts?: string[];
  changedFiles?: string[];
}

export type TraceNode =
  | TaskFrameNode
  | UserMessageNode
  | AssistantMessageNode
  | ThoughtSummaryNode
  | PlanNode
  | PhaseGroupNode
  | ToolActionNode
  | ObservationNode
  | FindingNode
  | ArtifactNode
  | ApprovalNode
  | ErrorNode
  | SubAgentNode
  | FinalResponseNode;

export type ToolCategory =
  'file' | 'shell' | 'code' | 'browser' | 'image' | 'data' | 'artifact' | 'sub_agent' | 'domain' | 'unknown';

export interface ObservationFact {
  label: string;
  value: string;
  evidenceRef?: EvidenceRef;
}

export interface ObservationNode extends BaseTraceNode {
  kind: 'observation';
  title: string;
  facts: ObservationFact[];
  summary?: string;
  supportedHypotheses?: string[];
  excludedHypotheses?: string[];
}

export type FindingSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface FindingNode extends BaseTraceNode {
  kind: 'finding';
  severity: FindingSeverity;
  title: string;
  diagnosis: string;
  evidenceRefs: EvidenceRef[];
  recommendation?: string;
  confidence: ReasoningConfidence;
}
