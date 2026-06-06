import type {
  ArtifactRef,
  AttachmentRef,
  BaseTraceNode,
  EvidenceRef,
  TraceStatus,
} from './base';
import type { ToolResultPreview } from './previews';
import type { ReasoningConfidence, VisibleReasoningMode } from './reasoning';

export type PhaseKind =
  | 'understand'
  | 'plan'
  | 'search'
  | 'inspect'
  | 'modify'
  | 'execute'
  | 'verify'
  | 'summarize'
  | 'custom';

export type ToolCategory =
  | 'file'
  | 'shell'
  | 'code'
  | 'browser'
  | 'image'
  | 'data'
  | 'artifact'
  | 'sub_agent'
  | 'domain'
  | 'unknown';

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

export type ArtifactNodeKind =
  | 'file'
  | 'code'
  | 'diff'
  | 'image'
  | 'table'
  | 'chart'
  | 'json'
  | 'log'
  | 'link'
  | 'binary'
  | 'domain_object';

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
