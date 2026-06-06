import type {
  TraceNode,
  TimelineProjection,
  TimelineNode,
  PhaseGroupNode,
  TaskFrameNode,
  ThoughtSummaryNode,
  ToolActionNode,
  PlanNode,
  ObservationNode,
  FindingNode,
  ArtifactNode,
  ApprovalNode,
  ErrorNode,
  SubAgentNode,
  AgentProfile,
  AgentRun,
} from '@shared/types/agenticTrace';
import type { ToolManifest } from '@shared/types/agenticTrace';
import { toolManifestRegistry } from './manifests/ToolManifestRegistry';

const rendererForNode = (node: TraceNode, manifest?: ToolManifest): string => {
  switch (node.kind) {
    case 'task_frame': return 'task_frame';
    case 'thought_summary': return 'thought_summary';
    case 'plan': return 'plan';
    case 'phase_group': return 'phase_group';
    case 'tool_action': return manifest?.renderer.key ?? `tool.${(node as ToolActionNode).category}`;
    case 'observation': return 'observation';
    case 'finding': return 'finding';
    case 'artifact': return `artifact.${(node as ArtifactNode).artifactKind}`;
    case 'approval': return 'approval';
    case 'error': return 'error';
    case 'sub_agent': return 'sub_agent';
    case 'final_response': return 'final_response';
    default: return 'unknown';
  }
};

const titleForNode = (node: TraceNode): string => {
  switch (node.kind) {
    case 'task_frame': return (node as TaskFrameNode).title || '本次任务';
    case 'thought_summary': return (node as ThoughtSummaryNode).intent.slice(0, 80);
    case 'tool_action': return (node as ToolActionNode).displayName;
    case 'plan': return (node as PlanNode).title || '执行计划';
    case 'phase_group': return (node as PhaseGroupNode).title;
    case 'observation': return (node as ObservationNode).title;
    case 'finding': return (node as FindingNode).title;
    case 'artifact': return (node as ArtifactNode).title;
    case 'approval': return (node as ApprovalNode).title;
    case 'error': return (node as ErrorNode).title;
    case 'sub_agent': return (node as SubAgentNode).title;
    case 'final_response': return '最终回答';
    default: return node.kind;
  }
};

const projectChild = (node: TraceNode, profile: AgentProfile, collapsedRun: boolean): TimelineNode => {
  const manifest = node.kind === 'tool_action'
    ? toolManifestRegistry.get((node as ToolActionNode).toolName)
    : undefined;

  const timelineNode: TimelineNode = {
    nodeId: node.id,
    sourceNodeIds: [node.id],
    renderer: rendererForNode(node, manifest),
    title: titleForNode(node),
    status: node.kind === 'approval'
      ? ((node as import('@shared/types/agenticTrace').ApprovalNode).status === 'approved'
        ? 'succeeded'
        : (node as import('@shared/types/agenticTrace').ApprovalNode).status === 'rejected'
          ? 'failed'
          : 'waiting_approval')
      : node.status,
    collapsedByDefault: node.kind === 'tool_action'
      ? (manifest?.renderer.defaultCollapsed ?? true)
      : node.kind === 'thought_summary'
        ? collapsedRun
        : false,
    importance: node.kind === 'task_frame' || node.kind === 'final_response' ? 'high' : 'normal',
    payload: node,
  };

  if (node.kind === 'phase_group') {
    const phase = node as PhaseGroupNode;
    timelineNode.children = phase.children.map((child) => projectChild(child, profile, collapsedRun));
    timelineNode.collapsedByDefault = collapsedRun || (profile.phases.find((p) => p.phaseId === phase.phase)?.defaultCollapsed ?? false);
  }

  return timelineNode;
};

export class ProjectionBuilder {
  build(run: AgentRun, nodes: TraceNode[], profile: AgentProfile): TimelineProjection {
    const collapsedRun = run.status === 'succeeded' || run.status === 'failed' || run.status === 'cancelled';
    const timelineNodes = nodes
      .filter((node) => node.kind !== 'phase_group' || (node as PhaseGroupNode).children.length > 0)
      .map((node) => projectChild(node, profile, collapsedRun));

    return {
      runId: run.runId,
      title: run.title ?? run.userRequest.slice(0, 60),
      status: run.status,
      nodes: timelineNodes,
    };
  }
}

export const projectionBuilder = new ProjectionBuilder();
