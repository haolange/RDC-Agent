import type { TraceStatus } from './base';

export type TimelineImportance = 'low' | 'normal' | 'high';

export interface TimelineNode {
  nodeId: string;
  sourceNodeIds: string[];
  renderer: string;
  title: string;
  subtitle?: string;
  status?: TraceStatus;
  collapsedByDefault?: boolean;
  importance?: TimelineImportance;
  children?: TimelineNode[];
  payload?: unknown;
}

export interface TimelineProjection {
  runId: string;
  title: string;
  status: TraceStatus;
  nodes: TimelineNode[];
}
