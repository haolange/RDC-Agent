import type { AgentRole } from './agent';
import type { ConversationMessage } from './conversation';

export type AgentNodeType =
  | 'conversation'
  | 'turn'
  | 'user_message'
  | 'assistant_message'
  | 'system_message'
  | 'agent_run'
  | 'manager_plan'
  | 'phase'
  | 'step'
  | 'group'
  | 'merge'
  | 'narrative'
  | 'tool_call'
  | 'tool_result'
  | 'subagent_run'
  | 'subagent_report'
  | 'artifact'
  | 'evidence'
  | 'final_answer'
  | 'error'
  | 'retry'
  | 'raw_detail'
  | 'metrics_summary';

export type AgentNodeStatus =
  | 'pending'
  | 'running'
  | 'streaming'
  | 'waiting_tool'
  | 'waiting_user'
  | 'merging'
  | 'succeeded'
  | 'partial_succeeded'
  | 'failed'
  | 'cancelled'
  | 'skipped'
  | 'blocked';

export type AgentEdgeType =
  | 'contains'
  | 'sequence'
  | 'depends_on'
  | 'produces'
  | 'consumes'
  | 'evidence_ref'
  | 'artifact_ref'
  | 'retry_of'
  | 'merge_source';

export interface NodeMetrics {
  durationMs?: number;
  tokenInput?: number;
  tokenOutput?: number;
  childCount?: number;
  toolCallCount?: number;
  subAgentCount?: number;
  artifactCount?: number;
  evidenceCount?: number;
  errorCount?: number;
  depth?: number;
  branchingFactor?: number;
  traceabilityScore?: number;
}

export interface NodeUIHints {
  importance?: 'low' | 'normal' | 'high' | 'critical';
  density?: 'compact' | 'normal' | 'expanded';
  initiallyPinned?: boolean;
  hiddenByDefault?: boolean;
  showInOutline?: boolean;
}

export interface AgentNode<TPayload = unknown> {
  id: string;
  type: AgentNodeType;
  status: AgentNodeStatus;
  title: string;
  summary?: string;
  parentId?: string;
  runId?: string;
  turnId?: string;
  order: number;
  createdAt: number;
  startedAt?: number;
  updatedAt?: number;
  completedAt?: number;
  payload?: TPayload;
  children?: string[];
  evidenceRefs?: string[];
  artifactRefs?: string[];
  expandable?: boolean;
  defaultExpanded?: boolean;
  metrics?: NodeMetrics;
  ui?: NodeUIHints;
}

export interface AgentEdge {
  id: string;
  type: AgentEdgeType;
  from: string;
  to: string;
  label?: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export type AgentExecutionMode =
  | 'single_agent'
  | 'tool_augmented'
  | 'multi_agent'
  | 'research'
  | 'coding'
  | 'debugging'
  | 'analysis';

export interface AgentRunPayload {
  agentName: string;
  agentRole?: string;
  objective: string;
  inputSummary?: string;
  planSummary?: string;
  executionMode: AgentExecutionMode;
  model?: string;
  progress?: {
    completed: number;
    total: number;
  };
}

export interface PhasePayload {
  objective: string;
  reason?: string;
  progress?: {
    completed: number;
    total: number;
  };
  phaseIndex: number;
}

export interface StepPayload {
  objective: string;
  why?: string;
  inputSummary?: string;
  expectedOutput?: string;
  actualOutput?: string;
}

export type GroupType =
  | 'tool_group'
  | 'subagent_group'
  | 'artifact_group'
  | 'evidence_group'
  | 'comparison_group'
  | 'decision_group'
  | 'section_group';

export type GroupStrategy =
  | 'sequential'
  | 'parallel'
  | 'map_reduce'
  | 'debate'
  | 'compare'
  | 'collect'
  | 'summarize'
  | 'vote';

export type MergePolicy =
  | 'none'
  | 'summary'
  | 'deduplicate'
  | 'conflict_resolution'
  | 'ranking'
  | 'vote'
  | 'final_decision';

export interface GroupPayload {
  groupType: GroupType;
  strategy: GroupStrategy;
  objective: string;
  mergePolicy?: MergePolicy;
  mergeNodeId?: string;
  progress?: {
    completed: number;
    total: number;
    failed?: number;
    skipped?: number;
  };
}

export interface ToolCallPayload {
  toolName: string;
  toolType:
    | 'shell'
    | 'file_read'
    | 'file_write'
    | 'search'
    | 'browser'
    | 'code_exec'
    | 'image'
    | 'database'
    | 'custom';
  purpose?: string;
  argumentsSummary: string;
  argumentsRaw?: unknown;
  resultSummary?: string;
  resultRaw?: unknown;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  retryCount?: number;
  retryOf?: string;
}

export interface Finding {
  id: string;
  claim: string;
  severity?: 'info' | 'warning' | 'critical';
  confidence?: number;
  evidenceRefs?: string[];
}

export interface SubAgentRunPayload {
  agentName: string;
  agentRole: string;
  objective: string;
  inputSummary?: string;
  methodSummary?: string;
  outputSummary?: string;
  confidence?: number;
  findings?: Finding[];
  internalRunId?: string;
}

export interface MergeConflict {
  id: string;
  description: string;
  sourceNodeIds: string[];
  resolution: 'selected_a' | 'selected_b' | 'merged' | 'discarded' | 'unresolved';
  reason?: string;
}

export interface MergePayload {
  sourceNodeIds: string[];
  agreements: string[];
  conflicts: MergeConflict[];
  selectedFindings: string[];
  discardedFindings: string[];
  finalSynthesis: string;
  confidence?: number;
}

export interface FinalClaim {
  id: string;
  text: string;
  evidenceRefs: string[];
  confidence?: number;
  importance?: 'low' | 'normal' | 'high' | 'critical';
}

export interface FinalAnswerPayload {
  answer: string;
  claims: FinalClaim[];
  nextActions?: string[];
  limitations?: string[];
  relatedArtifacts?: string[];
}

export interface ArtifactPayload {
  artifactType: 'file' | 'image' | 'screenshot' | 'code' | 'diff' | 'table' | 'report' | 'link' | 'dataset';
  name: string;
  path?: string;
  url?: string;
  mimeType?: string;
  sizeBytes?: number;
  preview?: unknown;
}

export interface EvidencePayload {
  claimId?: string;
  sourceNodeId: string;
  sourceType: 'tool_result' | 'file' | 'artifact' | 'subagent_report' | 'user_input' | 'model_output';
  quote?: string;
  range?: {
    start?: number;
    end?: number;
  };
  confidence?: number;
}

export interface NarrativePayload {
  content: string;
  format: 'plain' | 'markdown';
  narrativeType: 'explanation' | 'observation' | 'stage_summary' | 'decision_reason' | 'warning' | 'note';
}

export interface RawDetailPayload {
  detailType: 'markdown' | 'code' | 'json' | 'log' | 'diff' | 'table' | 'image' | 'file_list' | 'terminal';
  title?: string;
  language?: string;
  content: unknown;
  lazyLoadKey?: string;
}

export interface MetricsSummaryPayload {
  depth: number;
  branchingFactor: number;
  toolDensity: number;
  traceabilityScore: number;
  tokenOutput: number;
}

export interface TimelineProjection {
  id: string;
  turnId: string;
  runId?: string;
  nodes: Record<string, AgentNode>;
  edges: Record<string, AgentEdge>;
  rootNodeIds: string[];
  sourceMessages: ConversationMessage[];
}

export interface AgentTimelineEvent {
  eventId: string;
  type: 'node_added' | 'node_updated' | 'edge_added' | 'node_removed';
  node?: AgentNode;
  edge?: AgentEdge;
  nodeId?: string;
  patch?: Partial<AgentNode>;
  createdAt: number;
}

export interface TimelineAgentProfile {
  agentId: AgentRole | string;
  label: string;
  role: string;
}
