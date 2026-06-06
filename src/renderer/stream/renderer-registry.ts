import type { ComponentType } from 'react';
import type { TimelineNode } from '@shared/types/agenticTrace';
import {
  TaskFrameCard,
  ThoughtSummaryCard,
  PlanCard,
  PhaseGroupCard,
  ToolActionCard,
  ObservationCard,
  FindingCard,
  ArtifactCard,
  ApprovalCard,
  ErrorCard,
  SubAgentCard,
  FinalResponseCard,
  GenericTraceCard,
} from './cards/TraceCards';

export type TraceRendererProps = {
  node: TimelineNode;
  depth?: number;
  onSelect?: (nodeId: string) => void;
};

export const rendererRegistry: Record<string, ComponentType<TraceRendererProps>> = {
  task_frame: TaskFrameCard,
  thought_summary: ThoughtSummaryCard,
  plan: PlanCard,
  phase_group: PhaseGroupCard,
  'tool.file': ToolActionCard,
  'tool.file.read': ToolActionCard,
  'tool.file.search': ToolActionCard,
  'tool.shell': ToolActionCard,
  'tool.shell.run': ToolActionCard,
  'tool.code': ToolActionCard,
  'tool.code.search': ToolActionCard,
  'tool.domain': ToolActionCard,
  'tool.domain.rd': ToolActionCard,
  'tool.unknown': ToolActionCard,
  observation: ObservationCard,
  finding: FindingCard,
  artifact: ArtifactCard,
  approval: ApprovalCard,
  error: ErrorCard,
  sub_agent: SubAgentCard,
  final_response: FinalResponseCard,
  unknown: GenericTraceCard,
};

export const resolveRenderer = (key: string): ComponentType<TraceRendererProps> =>
  rendererRegistry[key] ?? GenericTraceCard;
