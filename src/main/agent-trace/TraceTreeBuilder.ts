import { generateEventId } from '@shared/utils/id';
import type { TraceEvent } from './TraceEventStore';
import type { TraceNode, ToolActionNode, PhaseGroupNode, FinalResponseNode, SubAgentNode, ErrorNode } from './traceNodes';
import type { AgentProfile } from './manifests/traceManifest';

const isTraceNode = (payload: unknown): payload is TraceNode => (
  typeof payload === 'object'
  && payload !== null
  && 'kind' in payload
  && 'id' in payload
);

export class TraceTreeBuilder {
  build(events: TraceEvent[], profile: AgentProfile): TraceNode[] {
    const nodes: TraceNode[] = [];
    let currentPhase: PhaseGroupNode | null = null;
    let seq = 0;

    const pushNode = (node: TraceNode, parentId?: string) => {
      const withMeta = {
        ...node,
        seq: seq++,
        parentId: parentId ?? node.parentId,
        // A stored payload passes only the kind/id check (isTraceNode), so its visibility may be missing.
        visibility: (node as Partial<TraceNode>).visibility ?? 'user',
      } as TraceNode;
      if (currentPhase && node.kind !== 'phase_group' && node.kind !== 'task_frame') {
        currentPhase.children.push(withMeta);
      } else {
        nodes.push(withMeta);
      }
    };

    const openPhase = (phaseId: string, title: string) => {
      if (currentPhase) {
        currentPhase.status = 'succeeded';
        nodes.push(currentPhase);
      }
      currentPhase = {
        id: generateEventId('phase'),
        runId: events[0]?.runId ?? '',
        kind: 'phase_group',
        title,
        phase: (profile.phases.find((p) => p.phaseId === phaseId)?.phaseId ?? 'custom') as PhaseGroupNode['phase'],
        children: [],
        status: 'running',
        seq: seq++,
        createdAt: new Date().toISOString(),
        visibility: 'user',
      };
    };

    const closePhase = () => {
      if (currentPhase) {
        currentPhase.status = 'succeeded';
        nodes.push(currentPhase);
        currentPhase = null;
      }
    };

    for (const event of events) {
      if (event.visibility === 'internal') continue;

      if (event.type === 'phase.started') {
        const payload = event.payload as { phaseId?: string; title?: string };
        openPhase(payload.phaseId ?? 'custom', payload.title ?? '执行阶段');
        continue;
      }
      if (event.type === 'phase.completed') {
        closePhase();
        continue;
      }

      if (event.type === 'node.created' || event.type === 'node.updated') {
        if (isTraceNode(event.payload)) {
          const node = event.payload as TraceNode;
          if (node.kind === 'phase_group') {
            closePhase();
            currentPhase = { ...node, children: node.children };
            continue;
          }
          pushNode(node);
        }
        continue;
      }

      if (event.type === 'tool.started' || event.type === 'tool.completed' || event.type === 'tool.failed') {
        if (isTraceNode(event.payload)) {
          pushNode(event.payload as ToolActionNode);
        }
        continue;
      }

      if (event.type === 'run.failed' || event.type === 'run.cancelled') {
        if (isTraceNode(event.payload)) {
          pushNode(event.payload as ErrorNode);
        }
        continue;
      }

      // run.completed
      closePhase();
      if (isTraceNode(event.payload)) {
        pushNode(event.payload as FinalResponseNode);
      }
    }

    closePhase();
    return nodes;
  }

  flatten(nodes: TraceNode[]): TraceNode[] {
    const result: TraceNode[] = [];
    const walk = (node: TraceNode) => {
      result.push(node);
      if (node.kind === 'phase_group') {
        for (const child of (node as PhaseGroupNode).children) {
          walk(child);
        }
      }
      if (node.kind === 'sub_agent' && (node as SubAgentNode).children) {
        for (const child of (node as SubAgentNode).children ?? []) {
          walk(child);
        }
      }
    };
    for (const node of nodes) walk(node);
    return result;
  }
}

export const traceTreeBuilder = new TraceTreeBuilder();
