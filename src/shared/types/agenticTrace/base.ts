export type TraceStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'skipped'
  | 'waiting_approval';

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

export type AttachmentKind =
  | 'file'
  | 'image'
  | 'audio'
  | 'video'
  | 'url'
  | 'text'
  | 'binary';

export interface AttachmentRef {
  attachmentId: string;
  kind: AttachmentKind;
  name?: string;
  uri?: string;
  mimeType?: string;
  metadata?: Record<string, unknown>;
}

export type EvidenceRefKind =
  | 'trace_node'
  | 'tool_call'
  | 'artifact'
  | 'file_range'
  | 'url'
  | 'log'
  | 'domain_object';

export interface EvidenceRef {
  kind: EvidenceRefKind;
  refId: string;
  label?: string;
  metadata?: Record<string, unknown>;
}

export type ArtifactRefKind =
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

export interface ArtifactRef {
  artifactId: string;
  kind: ArtifactRefKind;
  title: string;
  uri?: string;
  preview?: import('./previews').ToolResultPreview;
  metadata?: Record<string, unknown>;
}

export interface AgentRun {
  runId: string;
  agentType: string;
  title?: string;
  userRequest: string;
  status: TraceStatus;
  createdAt: string;
  updatedAt: string;
  context?: Record<string, unknown>;
  profileVersion?: string;
}
